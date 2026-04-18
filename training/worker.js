/**
 * Match worker.
 *
 * One of these runs per worker thread. The worker loads the game engine,
 * the policy network, and the reward accounting ONCE at startup (cost:
 * ~50-100ms of ESM resolution + JIT warmup), then sits in a message loop
 * executing match jobs as they arrive from the main thread.
 *
 * Wire protocol (see pool.js for the main-side view):
 *
 *   main → worker:  { type: 'match',    jobId, weightsA, weightsB, seed, sampleTemp }
 *                   { type: 'warmup',   jobId }            — run a throwaway match
 *                   { type: 'shutdown' }                    — exit cleanly
 *
 *   worker → main:  { type: 'match-result', jobId, winner, sitesA, sitesB,
 *                     rewardA, rewardB, ghostRewardsA, ghostRewardsB,
 *                     durationMs }
 *                   { type: 'warmup-done', jobId, durationMs }
 *                   { type: 'error', jobId, message }
 *
 * Each job's RNG is seeded from the job's own `seed` so the same job id
 * on the same worker pool size reproduces bit-identically regardless of
 * which worker happens to run it. Work is NOT attributable to a specific
 * worker for correctness — only for scheduling.
 */

import { parentPort } from 'node:worker_threads';

import { runMatch } from './env.js';
import {
  buildNet, maskedSample, randomWeights,
} from '../src/modes/breach/neural/Network.js';
import { encodeObservation, OBS_DIM } from '../src/modes/breach/neural/Observation.js';
import { buildMask, decodeAction } from '../src/modes/breach/neural/ActionDecoder.js';
import { seededRNG } from '../src/engine/hex.js';

if (!parentPort) {
  throw new Error('worker.js must be spawned as a Worker — parentPort is null');
}

// ── Planner factory (identical shape to train.js — kept inline so the
// worker doesn't import train.js and pull the main-thread CLI machinery.)

function makeTrainingPlanner(weightsSpec, rng, temperature) {
  const net = buildNet(weightsSpec);
  const pick = (logits, mask) => maskedSample(logits, mask, rng, temperature);
  return (input) => {
    if (!input?.actingGhosts?.length) return {};
    const snap = cloneSnapshotMinimal(input);
    const plans = {};
    const acting = input.actingGhosts.slice().sort((a, b) => a.uuid.localeCompare(b.uuid));
    for (const { uuid } of acting) {
      const self = snap.byUUID[uuid];
      if (!self) { plans[uuid] = [{ kind: 'pass' }]; continue; }
      let action;
      try {
        const obs = encodeObservation(uuid, snap);
        const mask = buildMask(uuid, snap);
        const logits = net.forward(obs);
        action = decodeAction(logits, mask, uuid, snap, pick);
      } catch { action = { kind: 'pass' }; }
      plans[uuid] = [action];
      applySpeculative(snap, uuid, action);
    }
    return plans;
  };
}

function cloneSnapshotMinimal(input) {
  const byUUID = {};
  for (const m of input.members || []) {
    byUUID[m.uuid] = {
      uuid: m.uuid, side: input.side,
      position: { q: m.position.q, r: m.position.r },
      points: m.points, alive: m.alive, hp: m.hp,
      responseWindowFor: [...(m.responseWindowFor || [])],
    };
  }
  return {
    byUUID,
    enemies: (input.enemies || []).map((e) => ({ ...e, position: { ...e.position } })),
    map: { tiles: input.map.tiles, sites: input.map.sites,
           structures: { ...(input.map.structures || {}) } },
    armedBombs: input.armedBombs || {},
    costs: input.costs, clock: input.clock,
  };
}

function applySpeculative(snap, uuid, action) {
  const m = snap.byUUID[uuid];
  if (!m) return;
  const c = snap.costs || {};
  switch (action?.kind) {
    case 'move':    m.position = { ...action.to }; m.points -= c.move || 0; break;
    case 'sprint': {
      m.position = { ...action.path[action.path.length - 1] };
      m.points -= (c.move || 0) * action.path.length;
      break;
    }
    case 'attack': {
      m.points -= c.attackPlayer || 0;
      const e = snap.enemies.find((e2) => e2.uuid === action.targetUUID);
      if (e) e.hp = Math.max(0, e.hp - 20);
      break;
    }
    case 'plant':   m.points -= c.plant || 0;   break;
    case 'defuse':  m.points -= c.defuse || 0;  break;
    case 'respawn': m.points -= c.respawn || 0; m.alive = true; m.hp = 100; break;
    default: break;
  }
}

// ── Job execution ─────────────────────────────────────────────────

function runMatchJob(msg) {
  const tStart = Date.now();
  const rng = seededRNG(msg.seed >>> 0);
  const plannerA = makeTrainingPlanner(msg.weightsA, rng, msg.sampleTemp);
  const plannerB = makeTrainingPlanner(msg.weightsB, rng, msg.sampleTemp);
  const result = runMatch({ plannerA, plannerB, seed: msg.seed });
  return {
    type: 'match-result',
    jobId: msg.jobId,
    winner: result.winner,
    sitesA: result.sitesA,
    sitesB: result.sitesB,
    rewardA: result.rewardA,
    rewardB: result.rewardB,
    ghostRewardsA: result.ghostRewardsA,
    ghostRewardsB: result.ghostRewardsB,
    ticks: result.ticks,
    durationMs: Date.now() - tStart,
  };
}

// ── Warmup ────────────────────────────────────────────────────────
//
// Node's ESM import chain and V8's JIT warmup add ~100-200ms of overhead
// to the first hot loop in each worker. Without warming, the first match
// on each worker takes 3-5x longer than steady-state. The pool lets the
// main thread pre-warm by submitting a throwaway job at startup so the
// measured match throughput after warmup is representative.

function runWarmupJob(msg) {
  const tStart = Date.now();
  const arch = {
    obsDim: OBS_DIM, hidden: [128, 128],
    primaryDim: 7, directionDim: 6, sprintLenDim: 3,
  };
  const dummy = randomWeights(arch, Math.random);
  const rng = seededRNG(1);
  const p = makeTrainingPlanner(dummy, rng, 1.0);
  runMatch({ plannerA: p, plannerB: p, seed: 1 });
  return { type: 'warmup-done', jobId: msg.jobId, durationMs: Date.now() - tStart };
}

// ── Message loop ──────────────────────────────────────────────────

parentPort.on('message', (msg) => {
  try {
    switch (msg?.type) {
      case 'match':
        parentPort.postMessage(runMatchJob(msg));
        break;
      case 'warmup':
        parentPort.postMessage(runWarmupJob(msg));
        break;
      case 'shutdown':
        process.exit(0);
        break;
      default:
        parentPort.postMessage({
          type: 'error',
          jobId: msg?.jobId ?? -1,
          message: `unknown message type: ${msg?.type}`,
        });
    }
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      jobId: msg?.jobId ?? -1,
      message: err.message || String(err),
      stack: err.stack,
    });
  }
});
