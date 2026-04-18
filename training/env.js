/**
 * Headless breach-match environment for training.
 *
 * THE POINT OF THIS FILE — it doesn't reimplement any game logic. It directly
 * imports resolveTick, runTurn, Bomb, rules, MapGen, and Constants from the
 * actual src/ tree and drives them from a loop that pretends to be the arena.
 *
 * The benefit is zero train/deploy drift: if a tick would play out one way in
 * the browser, it plays out identically here. A policy that learns to win
 * here wins for the same reason in the app.
 *
 * ── Public API ────────────────────────────────────────────────────
 *
 *   runMatch({ plannerA, plannerB, seed, opts }) => {
 *     winner: 'A' | 'B' | 'draw',
 *     sitesA, sitesB,        // site-rounds captured by each side across both halves
 *     rewardA, rewardB,      // per-policy summed reward (see rewards.js)
 *     ghostRewardsA,         // { uuid: reward } per-ghost credit breakdown
 *     ghostRewardsB,
 *     events,                // optional tick-level event log (suppressed by default)
 *     ticks,                 // total ticks simulated
 *   }
 *
 * Caller supplies two planner functions with the SAME signature Turn.js's
 * resolveTick expects on its `teamPlanner` input — this is how two policies
 * end up controlling two sides of one match without any special routing.
 *
 * ── Speed up ──────────────────────────────────────────────────────
 *
 * We compress the match: shorter halves, dense ghost income, early exit when
 * all sites resolve or a side is economically dead. Each match is typically
 * 200–800 ticks, not 7200. Policy learning doesn't depend on real-time; it
 * depends on seeing enough decision points.
 */

import { resolveTick } from '../src/modes/breach/Turn.js';
import { generateBreachMap } from '../src/modes/breach/MapGen.js';
import {
  SIDE,
  PHASE,
  costsForSide,
  PLAYER_MAX_HP,
} from '../src/modes/breach/Constants.js';
import { seededRNG, tileKey } from '../src/engine/hex.js';

import { computeTickRewards, computeTerminalRewards } from './rewards.js';

// ── Tunable training-match parameters ─────────────────────────────
//
// These override the live-game Constants for training only. Keeping them
// here (not in Constants.js) means the arena's real-match timing is never
// touched by training runs.

export const TRAIN_DEFAULTS = {
  halfDurationMs:       6 * 60 * 1000,   // 6 game-minutes per half (~360 ticks)
  tickMs:               1000,
  maxTicksSafety:       2000,            // absolute cap — prevents runaway loops
  incomeEveryMs:        4000,            // every 4 game-seconds a ghost earns points
  incomePerTick:        30,              // how many points per income event
  terminateWhenSitesResolved: true,      // early exit once all A/B/C are terminal
};

// ── Map + spawn handling ──────────────────────────────────────────

function buildInitialState(map, ghostSides) {
  // Place each ghost at its side's first spawn-zone tile (stacking allowed).
  const positions = {};
  const points = {};
  const pointsSpent = {};
  for (const [uuid, side] of Object.entries(ghostSides)) {
    const zone = map.spawnZones[side];
    const [q, r] = zone[0].split(',').map(Number);
    positions[uuid] = { q, r, hp: PLAYER_MAX_HP, alive: true };
    points[uuid] = 0;
    pointsSpent[uuid] = 0;
  }
  return {
    tiles: map.tiles,
    structures: {},
    positions,
    sites: JSON.parse(JSON.stringify(map.sites)),   // deep-clone because we mutate
    points,
    pointsSpent,
    armedBombs: { A: null, B: null, C: null },
    siteOutcomes: [],
  };
}

// ── Faux playback schedule (dense income) ─────────────────────────
//
// In the real game, ghost income is sampled from a real player's historical
// task stream. For training we don't need realism here — we just need both
// sides to have a steady stream of decision points. We give every ghost an
// identical dense schedule: one income event every `incomeEveryMs` starting
// at 1s in, through the end of the match. Ghosts unlock turns at those ms.

function buildTrainingPlayback(ghostUUIDs, opts) {
  const totalMs = opts.halfDurationMs * 2;
  const schedule = [];
  for (let t = 1000; t < totalMs; t += opts.incomeEveryMs) {
    schedule.push({
      completionOffsetMs: t,
      storedPoints: opts.incomePerTick,
      taskUUID: `train-${t}`,
    });
  }
  const pb = {};
  for (const u of ghostUUIDs) pb[u] = { schedule, nextCompletionCursor: 0, synthetic: true };
  return pb;
}

// ── One half of a match ───────────────────────────────────────────
//
// Runs from matchMs=halfStart to matchMs=halfEnd (or until all sites resolve,
// whichever comes first). Returns updated state + event log.

function runHalf({
  state, playback, teamSideByUUID, ghostSides, spawnKeys,
  halfNumber, halfStartMs, halfEndMs,
  plannerForSide, rng, opts,
  rewardAcc,   // { A: { uuids: Set, sum: number, perGhost: {uuid: number} }, B: ... }
}) {
  let curr = state;
  let pb = playback;
  let matchMs = halfStartMs;
  const events = [];

  // If all sites are already resolved (rare — only after a blitz half), skip.
  const anyIdle = () => Object.values(curr.sites).some((s) => s.state === 'idle');
  const maxTicks = Math.min(
    opts.maxTicksSafety,
    Math.ceil((halfEndMs - halfStartMs) / opts.tickMs) + 2,
  );

  const teamPlannerDispatch = (input) => {
    // `input.side` tells us which side needs a plan. Route to the right policy.
    const planner = plannerForSide(input.side);
    return planner(input);
  };

  for (let tick = 0; tick < maxTicks; tick += 1) {
    matchMs += opts.tickMs;
    if (matchMs > halfEndMs) break;

    const prevPositions = snapshotPositions(curr.positions);
    const prevSites = JSON.parse(JSON.stringify(curr.sites));
    const prevArmed = JSON.parse(JSON.stringify(curr.armedBombs));
    const prevPoints = { ...curr.points };

    const tickInput = {
      matchMs,
      halfNumber,
      halfStartMs,
      halfEndMs,
      state: curr,
      playback: pb,
      ghostSides,
      teamSideByUUID,
      spawnKeys,
      rng,
      teamPlanner: teamPlannerDispatch,
    };

    const out = resolveTick(tickInput);
    curr = out.state;
    pb = out.playback;

    // Reward shaping, per side.
    computeTickRewards({
      prev: { positions: prevPositions, sites: prevSites, armedBombs: prevArmed, points: prevPoints },
      next: curr,
      events: out.events || [],
      ghostSides,
      teamSideByUUID,
      sitesMap: prevSites,
      rewardAcc,
      halfDurationMs: opts.halfDurationMs,
    });

    if (out.events && out.events.length) events.push({ matchMs, events: out.events });

    if (opts.terminateWhenSitesResolved && !anyIdle()) break;
  }

  return { state: curr, playback: pb, events, matchMs };
}

function snapshotPositions(positions) {
  const out = {};
  for (const [u, p] of Object.entries(positions)) out[u] = { q: p.q, r: p.r, hp: p.hp, alive: p.alive };
  return out;
}

// ── Full match ────────────────────────────────────────────────────

export function runMatch({ plannerA, plannerB, seed = 1, opts: userOpts = {}, collectEvents = false }) {
  const opts = { ...TRAIN_DEFAULTS, ...userOpts };
  const rng = seededRNG(seed >>> 0);

  // 3 ghosts per side, 6 total. Simple UUIDs so logs are readable.
  const ghostsA = ['A0', 'A1', 'A2'];
  const ghostsB = ['B0', 'B1', 'B2'];

  // Pick map seed deterministically from the match seed so each match uses
  // different geometry — important for generalization.
  const map = generateBreachMap(seed >>> 0);

  // H1 side assignment: A attacks, B defends.
  const sidesH1 = {};
  for (const u of ghostsA) sidesH1[u] = SIDE.attacker;
  for (const u of ghostsB) sidesH1[u] = SIDE.defender;

  const teamSideByUUIDH1 = { ...sidesH1 };
  const spawnKeys = {
    attacker: map.spawnZones.attacker,
    defender: map.spawnZones.defender,
  };

  // Per-team reward accumulator — passes through both halves so terminal
  // rewards accrue to the right ghosts regardless of which side they're on.
  const rewardAcc = {
    A: { sum: 0, perGhost: Object.fromEntries(ghostsA.map((u) => [u, 0])) },
    B: { sum: 0, perGhost: Object.fromEntries(ghostsB.map((u) => [u, 0])) },
  };
  // Map uuid → team letter, fixed for the whole match.
  const teamOfUUID = {};
  ghostsA.forEach((u) => { teamOfUUID[u] = 'A'; });
  ghostsB.forEach((u) => { teamOfUUID[u] = 'B'; });
  rewardAcc.teamOfUUID = teamOfUUID;

  // Helper that routes a SIDE to its controlling POLICY given the current
  // half's side assignment.
  function plannerForSideFactory(sides) {
    return (side) => {
      // The side argument is 'attacker' or 'defender'. Look at the first
      // ghost on that side to determine which team letter owns it.
      const firstOnSide = Object.entries(sides).find(([, s]) => s === side);
      if (!firstOnSide) return plannerA;
      const team = teamOfUUID[firstOnSide[0]];
      return team === 'A' ? plannerA : plannerB;
    };
  }

  // Initial state + playback.
  let state = buildInitialState(map, sidesH1);
  let playback = buildTrainingPlayback([...ghostsA, ...ghostsB], opts);

  // ── Half 1 ──────────────────────────────────────────────────────
  const h1 = runHalf({
    state, playback,
    teamSideByUUID: teamSideByUUIDH1,
    ghostSides: sidesH1,
    spawnKeys,
    halfNumber: 1,
    halfStartMs: 0,
    halfEndMs: opts.halfDurationMs,
    plannerForSide: plannerForSideFactory(sidesH1),
    rng, opts,
    rewardAcc,
  });
  state = h1.state;
  playback = h1.playback;

  // ── Intermission: side swap, bomb/structure reset, positions reset ─
  // Side assignment flips.
  const sidesH2 = {};
  for (const u of ghostsA) sidesH2[u] = SIDE.defender;
  for (const u of ghostsB) sidesH2[u] = SIDE.attacker;
  const teamSideByUUIDH2 = { ...sidesH2 };

  // Keep sites resolved from H1 — they don't re-open. Reset structures,
  // armed bombs, positions to spawn. Points carry over (same as live).
  state = {
    ...state,
    structures: {},
    armedBombs: { A: null, B: null, C: null },
    positions: rebuildSpawnPositions(map, sidesH2),
  };

  // ── Half 2 ──────────────────────────────────────────────────────
  const h2 = runHalf({
    state, playback,
    teamSideByUUID: teamSideByUUIDH2,
    ghostSides: sidesH2,
    spawnKeys,
    halfNumber: 2,
    halfStartMs: opts.halfDurationMs,
    halfEndMs: opts.halfDurationMs * 2,
    plannerForSide: plannerForSideFactory(sidesH2),
    rng, opts,
    rewardAcc,
  });
  state = h2.state;
  playback = h2.playback;

  // ── Tally site outcomes from both halves ────────────────────────
  // state.siteOutcomes is a flat list across both halves.
  let sitesA = 0, sitesB = 0;
  for (const so of state.siteOutcomes || []) {
    const half = so.half || 1;
    // outcome 'attackers' means the attacker side of that half won the site.
    const attackerTeam = half === 1 ? 'A' : 'B';
    const defenderTeam = half === 1 ? 'B' : 'A';
    if (so.outcome === 'attackers') {
      if (attackerTeam === 'A') sitesA += 1; else sitesB += 1;
    } else if (so.outcome === 'defenders') {
      if (defenderTeam === 'A') sitesA += 1; else sitesB += 1;
    }
  }

  let winner = 'draw';
  if (sitesA > sitesB) winner = 'A';
  else if (sitesB > sitesA) winner = 'B';

  // Terminal reward — largest contribution to fitness.
  computeTerminalRewards({ winner, sitesA, sitesB, rewardAcc });

  return {
    winner,
    sitesA, sitesB,
    rewardA: rewardAcc.A.sum,
    rewardB: rewardAcc.B.sum,
    ghostRewardsA: { ...rewardAcc.A.perGhost },
    ghostRewardsB: { ...rewardAcc.B.perGhost },
    events: collectEvents ? [...h1.events, ...h2.events] : undefined,
    ticks: Math.ceil((h2.matchMs) / opts.tickMs),
  };
}

function rebuildSpawnPositions(map, sides) {
  const out = {};
  for (const [uuid, side] of Object.entries(sides)) {
    const zone = map.spawnZones[side];
    const [q, r] = zone[0].split(',').map(Number);
    out[uuid] = { q, r, hp: PLAYER_MAX_HP, alive: true };
  }
  return out;
}
