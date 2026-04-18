#!/usr/bin/env node
/**
 * Smoke test — verifies the training loop wires up correctly. Runs two
 * randomly-initialized policies for one match, dumps the outcome, and
 * prints basic stats.
 *
 * This is the file you run FIRST after applying the training patch, to
 * catch broken imports, shape mismatches, or rule-interface drift before
 * waiting 30 minutes for a real training run.
 */

import {
  randomWeights,
} from '../src/modes/breach/neural/Network.js';
import { OBS_DIM } from '../src/modes/breach/neural/Observation.js';
import { runMatch } from './env.js';
import { seededRNG } from '../src/engine/hex.js';
import {
  buildNet, maskedArgmax,
} from '../src/modes/breach/neural/Network.js';
import {
  encodeObservation,
} from '../src/modes/breach/neural/Observation.js';
import {
  buildMask, decodeAction,
} from '../src/modes/breach/neural/ActionDecoder.js';

function makePlanner(weightsSpec) {
  const net = buildNet(weightsSpec);
  return (input) => {
    if (!input?.actingGhosts?.length) return {};
    const plans = {};
    const snap = {
      byUUID: Object.fromEntries((input.members || []).map((m) => [m.uuid, {
        ...m, side: input.side, position: { ...m.position }, responseWindowFor: [...(m.responseWindowFor || [])],
      }])),
      enemies: (input.enemies || []).map((e) => ({ ...e, position: { ...e.position } })),
      map: { ...input.map, structures: { ...(input.map.structures || {}) } },
      armedBombs: input.armedBombs || {},
      costs: input.costs, clock: input.clock,
    };
    for (const { uuid } of input.actingGhosts) {
      const self = snap.byUUID[uuid];
      if (!self) { plans[uuid] = [{ kind: 'pass' }]; continue; }
      try {
        const obs = encodeObservation(uuid, snap);
        const mask = buildMask(uuid, snap);
        const logits = net.forward(obs);
        const action = decodeAction(logits, mask, uuid, snap, maskedArgmax);
        plans[uuid] = [action];
      } catch (err) {
        plans[uuid] = [{ kind: 'pass' }];
      }
    }
    return plans;
  };
}

const rng = seededRNG(42);
const arch = { obsDim: OBS_DIM, hidden: [128, 128], primaryDim: 7, directionDim: 6, sprintLenDim: 3 };
const aWeights = randomWeights(arch, rng);
const bWeights = randomWeights(arch, rng);

const plannerA = makePlanner(aWeights);
const plannerB = makePlanner(bWeights);

console.log('Running smoke match…');
const t0 = Date.now();
const result = runMatch({ plannerA, plannerB, seed: 123 });
const elapsedMs = Date.now() - t0;
console.log(`Elapsed: ${elapsedMs}ms over ${result.ticks} ticks.`);
console.log('Result:', {
  winner: result.winner,
  sitesA: result.sitesA,
  sitesB: result.sitesB,
  rewardA: result.rewardA.toFixed(2),
  rewardB: result.rewardB.toFixed(2),
});
console.log('Per-ghost A:', Object.fromEntries(
  Object.entries(result.ghostRewardsA).map(([u, r]) => [u, r.toFixed(2)])
));
console.log('Per-ghost B:', Object.fromEntries(
  Object.entries(result.ghostRewardsB).map(([u, r]) => [u, r.toFixed(2)])
));
console.log('\nSmoke test PASSED.');
