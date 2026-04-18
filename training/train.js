#!/usr/bin/env node
/**
 * Parallel training loop.
 *
 * The main thread owns the population and the evolutionary logic (selection,
 * crossover, mutation). Match execution is entirely offloaded to a worker
 * pool. Every match in a generation is dispatched at once and awaited with
 * Promise.all — on an N-core machine, N matches run truly in parallel, and
 * fitness for the whole generation accumulates as results stream back.
 *
 * ── Throughput notes ──────────────────────────────────────────────
 *
 * Ballpark on a laptop (8 logical cores → 7 workers):
 *   - ~30-50ms per match steady-state per worker
 *   - warmup: ~150-400ms per worker in parallel (one-shot)
 *   - a 200-matches-per-gen × 50-gen run completes in 3-6 minutes
 *
 * ── CLI (new in this rev) ─────────────────────────────────────────
 *
 *   --workers N              worker count (default: CPU count - 1)
 *   --noWarmup               skip pre-warmup (not recommended for real runs)
 *
 * Every other flag is unchanged from the serial trainer it replaces.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';

import { OBS_DIM } from '../src/modes/breach/neural/Observation.js';
import { seededRNG } from '../src/engine/hex.js';
import { seedPopulation, produceNextGeneration } from './population.js';
import { MatchPool } from './pool.js';

// ── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const cpu = os.cpus()?.length || 4;
  const out = {
    generations:     30,
    population:      24,
    matchesPerGen:   60,
    elite:           4,
    mutationRate:    0.1,
    mutationSigma:   0.05,
    seed:            (Date.now() & 0x7fffffff) >>> 0,
    out:             './weights.trained.json',
    bestEveryGen:    false,
    sampleTemp:      0.8,
    tournamentK:     4,
    hidden:          [128, 128],
    workers:         Math.max(1, cpu - 1),
    noWarmup:        false,
  };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    const v = a[i + 1];
    switch (k) {
      case '--generations':    out.generations    = parseInt(v, 10); i += 1; break;
      case '--population':     out.population     = parseInt(v, 10); i += 1; break;
      case '--matchesPerGen':  out.matchesPerGen  = parseInt(v, 10); i += 1; break;
      case '--elite':          out.elite          = parseInt(v, 10); i += 1; break;
      case '--mutationRate':   out.mutationRate   = parseFloat(v);   i += 1; break;
      case '--mutationSigma':  out.mutationSigma  = parseFloat(v);   i += 1; break;
      case '--seed':           out.seed           = parseInt(v, 10); i += 1; break;
      case '--out':            out.out            = v;               i += 1; break;
      case '--bestEveryGen':   out.bestEveryGen   = true;             break;
      case '--sampleTemp':     out.sampleTemp     = parseFloat(v);   i += 1; break;
      case '--tournamentK':    out.tournamentK    = parseInt(v, 10); i += 1; break;
      case '--workers':        out.workers        = parseInt(v, 10); i += 1; break;
      case '--noWarmup':       out.noWarmup       = true;             break;
      default:
        if (k.startsWith('--')) throw new Error(`Unknown flag: ${k}`);
    }
  }
  return out;
}

// ── Scheduling ────────────────────────────────────────────────────

function scheduleMatches(pop, hallOfFame, matchesPerGen, rng) {
  const n = pop.length;
  const matches = [];
  for (let m = 0; m < matchesPerGen; m += 1) {
    const useHoF = hallOfFame && rng() < 0.2;
    const i = Math.floor(rng() * n);
    let j = useHoF ? -1 : Math.floor(rng() * n);
    while (!useHoF && j === i) j = Math.floor(rng() * n);
    matches.push({ aIdx: i, bIdx: useHoF ? 'hof' : j, seed: Math.floor(rng() * 2 ** 31) });
  }
  return matches;
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const cfg = parseArgs(process.argv);
  console.log('▶ breach policy trainer (parallel)');
  console.log(JSON.stringify(cfg, null, 2));

  const arch = {
    obsDim: OBS_DIM, hidden: cfg.hidden,
    primaryDim: 7, directionDim: 6, sprintLenDim: 3,
  };
  const rng = seededRNG(cfg.seed);

  // Pool + warmup.
  const poolStartMs = Date.now();
  const pool = new MatchPool({ workerCount: cfg.workers });
  console.log(`⚡ spawned ${cfg.workers} worker(s)`);
  if (!cfg.noWarmup) {
    const tWarm = Date.now();
    await pool.warmup();
    console.log(`⚡ warmup completed in ${Date.now() - tWarm}ms`);
  }

  let population = seedPopulation(cfg.population, arch, rng);
  let hallOfFame = null;

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const outAbs    = path.resolve(__dirname, cfg.out);

  const stats = { bestFitnessEachGen: [], meanFitnessEachGen: [] };

  try {
    for (let gen = 0; gen < cfg.generations; gen += 1) {
      const tGenStart = Date.now();

      for (const ind of population) {
        ind.fitness = 0; ind.matchesPlayed = 0;
        ind.wins = 0; ind.draws = 0; ind.losses = 0;
      }

      const schedule = scheduleMatches(population, hallOfFame, cfg.matchesPerGen, rng);

      // Dispatch every match simultaneously — the pool queues any overflow
      // past worker capacity. Promise.all awaits the full generation.
      const promises = schedule.map(({ aIdx, bIdx, seed }) => {
        const a = population[aIdx];
        const b = bIdx === 'hof' ? hallOfFame : population[bIdx];
        return pool.runMatch({
          weightsA: a.weights,
          weightsB: b.weights,
          seed,
          sampleTemp: cfg.sampleTemp,
        }).then((result) => ({ result, aIdx, bIdx }));
      });

      const results = await Promise.all(promises);

      for (const { result, aIdx, bIdx } of results) {
        const a = population[aIdx];
        a.fitness += result.rewardA; a.matchesPlayed += 1;
        if (result.winner === 'A') a.wins += 1;
        else if (result.winner === 'B') a.losses += 1;
        else a.draws += 1;
        if (bIdx !== 'hof') {
          const b = population[bIdx];
          b.fitness += result.rewardB; b.matchesPlayed += 1;
          if (result.winner === 'B') b.wins += 1;
          else if (result.winner === 'A') b.losses += 1;
          else b.draws += 1;
        }
      }

      for (const ind of population) {
        ind.fitness = ind.matchesPlayed > 0
          ? ind.fitness / ind.matchesPlayed
          : -Infinity;
      }

      const sorted = population.slice().sort((a, b) => b.fitness - a.fitness);
      const best = sorted[0];
      const mean = population.reduce(
        (s, i) => s + (isFinite(i.fitness) ? i.fitness : 0), 0) / population.length;
      stats.bestFitnessEachGen.push(best.fitness);
      stats.meanFitnessEachGen.push(mean);

      const elapsedS = ((Date.now() - tGenStart) / 1000).toFixed(1);
      const throughput = (cfg.matchesPerGen / ((Date.now() - tGenStart) / 1000)).toFixed(1);
      console.log(
        `gen ${String(gen).padStart(3, '0')}  `
        + `best=${best.fitness.toFixed(2).padStart(8)} `
        + `mean=${mean.toFixed(2).padStart(8)}  `
        + `wins=${best.wins}/${best.matchesPlayed}  `
        + `elapsed=${elapsedS}s  throughput=${throughput}/s`,
      );

      if (!hallOfFame || best.fitness > (hallOfFame.fitness || -Infinity)) {
        hallOfFame = { weights: best.weights, fitness: best.fitness, gen };
      }

      if (cfg.bestEveryGen) {
        const gPath = outAbs.replace(/\.json$/, `.gen${gen}.json`);
        writeWeights(gPath, best.weights, { gen, fitness: best.fitness, seed: cfg.seed });
      }

      if (gen < cfg.generations - 1) {
        population = produceNextGeneration(population, {
          size: cfg.population, arch,
          eliteCount: cfg.elite,
          mutationRate: cfg.mutationRate,
          mutationSigma: cfg.mutationSigma,
          tournamentK: cfg.tournamentK,
          generation: gen + 1, rng,
        });
      }
    }

    const finalSorted = population.slice().sort((a, b) => b.fitness - a.fitness);
    const champion = finalSorted[0];
    writeWeights(outAbs, champion.weights, {
      gen: cfg.generations - 1,
      fitness: champion.fitness,
      seed: cfg.seed,
      populationSize: cfg.population,
      generations: cfg.generations,
    });

    const poolStats = pool.snapshotStats(poolStartMs);
    console.log('\n── Pool stats ────────────────────');
    console.log(`  workers:             ${poolStats.workerCount}`);
    console.log(`  matches run:         ${poolStats.matchesRun}`);
    console.log(`  matches failed:      ${poolStats.matchesFailed}`);
    console.log(`  mean match duration: ${poolStats.meanMatchDurationMs.toFixed(1)}ms`);
    console.log(`  total wall time:     ${(poolStats.totalWallMs / 1000).toFixed(1)}s`);
    const meanUtil = poolStats.utilization.reduce((s, u) => s + u, 0)
                   / poolStats.utilization.length;
    console.log(`  mean worker util:    ${(meanUtil * 100).toFixed(1)}%`);
    console.log(`  matches per worker:  ${poolStats.matchesPerWorker.join(', ')}`);

    console.log(`\n✔ wrote champion weights to ${outAbs}`);
    console.log(`  final fitness: ${champion.fitness.toFixed(2)}`);
    console.log(`  per-gen best:  ${stats.bestFitnessEachGen.map(
      (v) => v.toFixed(1)).join(' → ')}`);

  } finally {
    await pool.shutdown();
  }
}

function writeWeights(file, weightsSpec, meta) {
  const out = { ...weightsSpec, meta: { createdAt: new Date().toISOString(), ...meta } };
  fs.writeFileSync(file, JSON.stringify(out));
}

main().catch((err) => {
  console.error('trainer failed:', err);
  process.exit(1);
});
