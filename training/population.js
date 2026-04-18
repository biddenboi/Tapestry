/**
 * Population operators for evolutionary self-play.
 *
 * We do not use PPO, REINFORCE, or any gradient-based method. Instead:
 *
 *   - A population of N individuals, each a full weights object.
 *   - Each generation: every individual plays `matchesPerIndividual` matches
 *     against randomly-sampled OTHER individuals (plus occasional matches
 *     against a snapshot of last-generation's best, to prevent forgetting).
 *   - Fitness = total reward across matches, averaged.
 *   - Selection: TOP `eliteCount` pass through unchanged. The rest of the
 *     slots are filled by tournament-selected parents → crossover → mutate.
 *
 * Why evolutionary over PPO for this problem:
 *
 *   1. Zero framework dependency. Pure numpy-free JS, runs wherever Node runs.
 *   2. Naturally parallelizable — matches are independent, can trivially
 *      shard across worker threads. Gradient methods need a centralized
 *      parameter server.
 *   3. No credit-assignment gymnastics. Every match produces one scalar
 *      fitness per policy. No advantage estimation, no GAE, no KL-clipping.
 *   4. Multi-agent self-play is natively adversarial — pairs play, winner
 *      advances. A gradient method would need explicit opponent modeling or
 *      league play to avoid collapse.
 *
 * What we sacrifice: sample efficiency. ES needs roughly 10x more matches
 * than PPO to reach the same policy quality. That's the trade-off, and it's
 * fine here because a match simulates in ~10-50ms so we can run millions
 * of them on a laptop overnight.
 */

import { randomWeights } from '../src/modes/breach/neural/Network.js';

// ── Weight (de)composition ────────────────────────────────────────
//
// Gaussian mutation and uniform crossover operate on raw flat arrays of
// floats. We serialize the full weight dictionary into one long Float32Array,
// operate, then deserialize back. Keeping the flat form keeps mutation O(N)
// with no nested loop over layers.

const PARAM_KEYS = ['W1', 'b1', 'W2', 'b2', 'Wp', 'bp', 'Wd', 'bd', 'Ws', 'bs'];

export function flattenWeights(spec) {
  const sizes = PARAM_KEYS.map((k) => spec.weights[k].length);
  const total = sizes.reduce((a, b) => a + b, 0);
  const flat = new Float32Array(total);
  let off = 0;
  for (const k of PARAM_KEYS) {
    const arr = spec.weights[k];
    for (let i = 0; i < arr.length; i += 1) flat[off + i] = arr[i];
    off += arr.length;
  }
  return { flat, sizes };
}

export function unflattenWeights(flat, spec) {
  const out = { format: spec.format, arch: { ...spec.arch }, weights: {} };
  let off = 0;
  for (const k of PARAM_KEYS) {
    const n = spec.weights[k].length;
    out.weights[k] = Array.from(flat.subarray(off, off + n));
    off += n;
  }
  return out;
}

// ── Genetic operators ─────────────────────────────────────────────

function gaussian(rng) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Mutate a flat weight vector in place. `rate` is the fraction of weights
 * perturbed; `sigma` is the std-dev of each perturbation. Only perturbing a
 * fraction of weights (rather than all of them) is a trick borrowed from NEAT:
 * it preserves most of the parent's behaviour while exploring a handful of
 * neighboring directions — empirically works better than perturbing everything
 * with a tiny sigma.
 */
export function mutate(flat, rng, { rate = 0.1, sigma = 0.05 } = {}) {
  const out = new Float32Array(flat);
  for (let i = 0; i < out.length; i += 1) {
    if (rng() < rate) out[i] += gaussian(rng) * sigma;
  }
  return out;
}

/**
 * Uniform crossover — each weight is independently drawn from parent A or B.
 * Simple, reliable, works well on MLP params where layer boundaries don't
 * impose a natural alignment.
 */
export function crossover(flatA, flatB, rng) {
  if (flatA.length !== flatB.length) throw new Error('crossover: length mismatch');
  const out = new Float32Array(flatA.length);
  for (let i = 0; i < out.length; i += 1) out[i] = rng() < 0.5 ? flatA[i] : flatB[i];
  return out;
}

// ── Selection ─────────────────────────────────────────────────────

/**
 * Tournament selection: sample K individuals, return the one with the
 * highest fitness. Pressure is controlled by K — higher K = more elitist.
 */
export function tournamentPick(pop, rng, k = 4) {
  let best = null;
  for (let i = 0; i < k; i += 1) {
    const cand = pop[Math.floor(rng() * pop.length)];
    if (!best || cand.fitness > best.fitness) best = cand;
  }
  return best;
}

// ── Population init / reproduction ────────────────────────────────

export function seedPopulation(size, arch, rng) {
  const pop = [];
  for (let i = 0; i < size; i += 1) {
    const weights = randomWeights(arch, rng);
    pop.push({
      id: `g0-i${i}`,
      weights,
      fitness: 0,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    });
  }
  return pop;
}

/**
 * Produce the next generation's population from the evaluated current one.
 *
 * Top `eliteCount` individuals are preserved VERBATIM — no mutation, no
 * crossover. This is essential for ES stability: without elitism, a bad
 * mutation can throw away hard-won progress. The remaining (size -
 * eliteCount) slots are filled with mutated offspring from tournament-
 * selected parents.
 *
 * 20% of the non-elite slots get a lone-parent mutation (clone+perturb);
 * the other 80% use crossover+mutation. Pure crossover-less produces less
 * diversity; pure crossover-all risks averaging promising parents into a
 * mediocre child.
 */
export function produceNextGeneration(evaluated, {
  size, arch, eliteCount, mutationRate, mutationSigma, tournamentK,
  generation, rng,
}) {
  const sorted = evaluated.slice().sort((a, b) => b.fitness - a.fitness);
  const next = [];

  // Elite — pass through untouched (but reset match counters so fitness is
  // re-estimated each generation against the new population).
  for (let i = 0; i < eliteCount && i < sorted.length; i += 1) {
    next.push({
      id: `g${generation}-e${i}-from-${sorted[i].id}`,
      weights: sorted[i].weights,
      fitness: 0,
      matchesPlayed: 0,
      wins: 0, draws: 0, losses: 0,
      isElite: true,
      eliteRank: i,
      parentFitness: sorted[i].fitness,
    });
  }

  // Fill rest via crossover + mutation or lone mutation.
  let idx = 0;
  while (next.length < size) {
    const parent1 = tournamentPick(sorted, rng, tournamentK);
    let childFlat;
    if (rng() < 0.8) {
      // Crossover path.
      let parent2 = tournamentPick(sorted, rng, tournamentK);
      // Avoid same-parent crossover — it's pure mutation with extra steps.
      for (let tries = 0; parent2 === parent1 && tries < 3; tries += 1) {
        parent2 = tournamentPick(sorted, rng, tournamentK);
      }
      const { flat: a } = flattenWeights(parent1.weights);
      const { flat: b } = flattenWeights(parent2.weights);
      childFlat = mutate(crossover(a, b, rng), rng,
        { rate: mutationRate, sigma: mutationSigma });
    } else {
      const { flat } = flattenWeights(parent1.weights);
      // Lone-mutation gets a slightly bigger sigma — this is our "explore
      // further from the best we've seen" knob.
      childFlat = mutate(flat, rng, { rate: mutationRate * 1.5, sigma: mutationSigma * 1.5 });
    }
    const childWeights = unflattenWeights(childFlat, parent1.weights);
    next.push({
      id: `g${generation}-c${idx}`,
      weights: childWeights,
      fitness: 0, matchesPlayed: 0,
      wins: 0, draws: 0, losses: 0,
    });
    idx += 1;
  }

  return next;
}
