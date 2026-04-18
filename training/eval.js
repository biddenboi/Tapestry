#!/usr/bin/env node
/**
 * Eval — head-to-head between two neural weights files.
 *
 * The rule-based planner has been stripped from the codebase, so there is no
 * built-in "baseline" to measure trained weights against. Instead, eval takes
 * TWO weights files — a challenger and a baseline — and plays matches
 * between them. Common uses:
 *
 *   - Challenger = newly-trained weights, Baseline = current shipped weights.
 *     Tells you whether to deploy the new file.
 *   - Challenger = gen-200 checkpoint, Baseline = gen-100 checkpoint. Tells
 *     you whether training is actually still improving.
 *   - Challenger = new-architecture weights, Baseline = old-architecture
 *     weights of similar training budget. Tells you whether an arch change
 *     paid off.
 *
 * Both weights files must be valid `breach-policy-v1` files. Mismatched
 * architectures across the two files are fine — this runs inference only,
 * and each side uses its own net independently.
 *
 * Usage:
 *   node eval.js --challenger weights.trained.json [--baseline weights.default.json]
 *                [--matches N] [--seed N] [--deterministic]
 *
 *   --challenger PATH    the weights file under test (required)
 *   --baseline PATH      weights to compare against (default: shipped default)
 *   --matches N          match count, default 50
 *   --seed N             base RNG seed, default 1
 *   --deterministic      use argmax (no exploration). Default: temp-0.8 sample.
 *                        Deterministic eval is fairer across runs but less
 *                        informative about robustness — a policy that only
 *                        wins via one exact argmax path is brittle.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { buildNet, maskedArgmax, maskedSample } from '../src/modes/breach/neural/Network.js';
import { encodeObservation } from '../src/modes/breach/neural/Observation.js';
import { buildMask, decodeAction } from '../src/modes/breach/neural/ActionDecoder.js';
import { seededRNG } from '../src/engine/hex.js';

import { runMatch } from './env.js';

// ── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const out = {
    challenger:    null,
    baseline:      path.resolve(__dirname, '../src/modes/breach/neural/weights.default.json'),
    matches:       50,
    seed:          1,
    deterministic: false,
  };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    switch (a[i]) {
      case '--challenger':    out.challenger = a[i + 1]; i += 1; break;
      case '--baseline':      out.baseline   = a[i + 1]; i += 1; break;
      case '--matches':       out.matches    = parseInt(a[i + 1], 10); i += 1; break;
      case '--seed':          out.seed       = parseInt(a[i + 1], 10); i += 1; break;
      case '--deterministic': out.deterministic = true; break;
      default: break;
    }
  }
  if (!out.challenger) {
    console.error('usage: node eval.js --challenger PATH [--baseline PATH] [--matches N]');
    process.exit(1);
  }
  return out;
}

// ── Neural planner factory ──────────────────────────────────────────

function makePlanner(spec, rng, deterministic) {
  const net = buildNet(spec);
  const pick = deterministic
    ? maskedArgmax
    : (logits, mask) => maskedSample(logits, mask, rng, 0.8);
  return (input) => {
    if (!input?.actingGhosts?.length) return {};
    const snap = {
      byUUID: Object.fromEntries((input.members || []).map((m) => [m.uuid, {
        ...m, side: input.side, position: { ...m.position },
        responseWindowFor: [...(m.responseWindowFor || [])],
      }])),
      enemies: (input.enemies || []).map((e) => ({ ...e, position: { ...e.position } })),
      map: { ...input.map, structures: { ...(input.map.structures || {}) } },
      armedBombs: input.armedBombs || {},
      costs: input.costs, clock: input.clock,
    };
    const plans = {};
    for (const { uuid } of input.actingGhosts) {
      if (!snap.byUUID[uuid]) { plans[uuid] = [{ kind: 'pass' }]; continue; }
      try {
        const obs = encodeObservation(uuid, snap);
        const mask = buildMask(uuid, snap);
        const logits = net.forward(obs);
        plans[uuid] = [decodeAction(logits, mask, uuid, snap, pick)];
      } catch { plans[uuid] = [{ kind: 'pass' }]; }
    }
    return plans;
  };
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  const cfg = parseArgs(process.argv);
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

  const challengerPath = path.resolve(__dirname, cfg.challenger);
  const baselinePath   = path.resolve(__dirname, cfg.baseline);

  const challenger = JSON.parse(fs.readFileSync(challengerPath, 'utf8'));
  const baseline   = JSON.parse(fs.readFileSync(baselinePath,   'utf8'));

  const rng = seededRNG(cfg.seed);
  const nnChallenger = makePlanner(challenger, rng, cfg.deterministic);
  const nnBaseline   = makePlanner(baseline,   rng, cfg.deterministic);

  console.log(`Challenger: ${cfg.challenger}`);
  console.log(`Baseline:   ${cfg.baseline}`);
  console.log(`Matches:    ${cfg.matches}  seed=${cfg.seed}  `
    + `${cfg.deterministic ? 'deterministic' : 'stochastic'}\n`);

  let wins = 0, losses = 0, draws = 0;
  let siteDiffSum = 0, rewardSum = 0;

  for (let m = 0; m < cfg.matches; m += 1) {
    // Alternate which side A belongs to — removes role bias.
    const chIsA = m % 2 === 0;
    const [plannerA, plannerB] = chIsA ? [nnChallenger, nnBaseline] : [nnBaseline, nnChallenger];
    const result = runMatch({ plannerA, plannerB, seed: cfg.seed + m });

    const chSites   = chIsA ? result.sitesA : result.sitesB;
    const basSites  = chIsA ? result.sitesB : result.sitesA;
    const chReward  = chIsA ? result.rewardA : result.rewardB;
    siteDiffSum += (chSites - basSites);
    rewardSum   += chReward;

    const chWon  = (chIsA && result.winner === 'A') || (!chIsA && result.winner === 'B');
    const chLost = (chIsA && result.winner === 'B') || (!chIsA && result.winner === 'A');
    if (chWon) wins += 1;
    else if (chLost) losses += 1;
    else draws += 1;
  }

  const winPct = 100 * wins / cfg.matches;
  console.log('── Results (challenger perspective) ─────────');
  console.log(`  Wins:   ${wins}  (${winPct.toFixed(1)}%)`);
  console.log(`  Losses: ${losses}  (${(100 * losses / cfg.matches).toFixed(1)}%)`);
  console.log(`  Draws:  ${draws}`);
  console.log(`  Mean site differential (challenger - baseline): `
    + `${(siteDiffSum / cfg.matches).toFixed(2)}`);
  console.log(`  Mean reward (challenger side): `
    + `${(rewardSum / cfg.matches).toFixed(2)}`);

  // Rough significance: a 50-match eval is pretty noisy. Flag anything
  // inside ±5pp of 50% as "inconclusive."
  const conclusive = Math.abs(winPct - 50) > 5;
  console.log(`\n  Verdict: ${
    !conclusive       ? '≈ tie (within noise — run more matches)' :
    winPct >  55      ? '✔ challenger beats baseline' :
                        '✗ challenger worse than baseline'
  }`);
}

main();
