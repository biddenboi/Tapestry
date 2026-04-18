/**
 * Breach turn resolver.
 *
 * Applies validated actions to match state. Pure functions — each returns new
 * state slices without mutating inputs.
 *
 * Two public entry points:
 *   - `runTurn(actions, ctx)` — validates and applies an ordered list of
 *     actions for one actor. Drops remaining actions on first invalid action
 *     (spec §3.7). Returns { state, applied, rejected }.
 *   - `resolveTick(input)` — deterministic per-tick resolution order
 *     (spec §3.6): clock events → human action (arena-driven) → ghost unlocks
 *     → ghost turns → bookkeeping.
 *
 * Supported action kinds:
 *   move, sprint, attack, respawn, pass, plant, defuse, breach
 *
 * ── teamPlanner is REQUIRED on the input ─────────────────────────
 *
 * The resolver does not know how to choose actions. It delegates to
 * `input.teamPlanner` (typically `breachDescriptor.teamPlanner`), which in
 * this build is the Neural Team Planner. No default is imported — the old
 * rule-based fallback was removed when the rules were stripped out.
 * Passing an input without `teamPlanner` now throws loudly on first use.
 *
 * ctx shape used throughout runTurn and its appliers:
 *   {
 *     tiles, structures, positions, sites,
 *     points, pointsSpent,
 *     actor: { uuid, side },
 *     teamSideByUUID,
 *     spawnKeys: { attacker, defender },
 *     rng,
 *     matchMs,
 *   }
 */

import {
  validateMove,
  validateSprint,
  validateAttackPlayer,
  validateRespawn,
  validatePlant,
  validateDefuse,
  validateBreach,
} from './rules.js';
import {
  PLAYER_MAX_HP,
  PLAYER_ATTACK_DAMAGE,
  PLANNER_MAX_ACTIONS_PER_TURN,
  ENEMY_VISIBILITY_RADIUS,
  MINE_DAMAGE,
  SIDE,
  costsForSide,
} from './Constants.js';
import { advanceCursor } from '../../engine/Playback.js';
import { hexDist, tileKey } from '../../engine/hex.js';
import { transitionBomb, consumeResponseWindow, tickAllBombs } from './Bomb.js';

// ── Public: run one actor's turn ───────────────────────────────────

export function runTurn(actions, ctxIn) {
  let ctx = ctxIn;
  const applied = [];
  const take = Array.isArray(actions)
    ? actions.slice(0, PLANNER_MAX_ACTIONS_PER_TURN)
    : [];

  for (const action of take) {
    const ruleCtx = buildRuleCtx(ctx);
    const outcome = tryApply(action, ctx, ruleCtx);
    if (!outcome.ok) {
      ctx = maybeConsumeResponseWindow(ctx);
      return {
        state: extractState(ctx),
        applied,
        rejected: { action, reason: outcome.reason },
      };
    }
    ctx = outcome.ctx;
    applied.push({ ...action, costPoints: outcome.costPoints || 0, ...(outcome.meta || {}) });
  }

  ctx = maybeConsumeResponseWindow(ctx);
  return { state: extractState(ctx), applied, rejected: null };
}

function maybeConsumeResponseWindow(ctx) {
  if (ctx.actor.side !== SIDE.defender || !ctx.armedBombs) return ctx;
  const armedBombs = consumeResponseWindow(ctx.armedBombs, ctx.actor.uuid);
  if (armedBombs === ctx.armedBombs) return ctx;

  const swept = tickAllBombs(ctx.sites, armedBombs, ctx.matchMs, ctx.halfNumber);
  return {
    ...ctx,
    sites: swept.sites,
    armedBombs: swept.armedBombs,
    siteOutcomes: swept.outcomes.length > 0
      ? [...(ctx.siteOutcomes || []), ...swept.outcomes]
      : ctx.siteOutcomes,
  };
}

function buildRuleCtx(ctx) {
  const pos = ctx.positions[ctx.actor.uuid] || { q: 0, r: 0 };
  return {
    tiles: ctx.tiles,
    structures: ctx.structures || {},
    positions: ctx.positions,
    sites: ctx.sites,
    armedBombs: ctx.armedBombs || {},
    teamSideByUUID: ctx.teamSideByUUID,
    actor: {
      uuid: ctx.actor.uuid,
      position: { q: pos.q, r: pos.r },
      side: ctx.actor.side,
      points: ctx.points[ctx.actor.uuid] || 0,
      alive: pos.alive !== false,
      hp: pos.hp ?? PLAYER_MAX_HP,
    },
  };
}

function extractState(ctx) {
  return {
    tiles: ctx.tiles,
    structures: ctx.structures,
    positions: ctx.positions,
    sites: ctx.sites,
    points: ctx.points,
    pointsSpent: ctx.pointsSpent,
    armedBombs: ctx.armedBombs,
    siteOutcomes: ctx.siteOutcomes,
  };
}

function spend(ctx, cost) {
  const uuid = ctx.actor.uuid;
  return {
    ...ctx,
    points:      { ...ctx.points,      [uuid]: Math.max(0, (ctx.points[uuid] || 0) - cost) },
    pointsSpent: { ...ctx.pointsSpent, [uuid]: (ctx.pointsSpent[uuid] || 0) + cost },
  };
}

function withPositions(ctx, positions) {
  return { ...ctx, positions };
}

// ── Per-action dispatch ───────────────────────────────────────────

function tryApply(action, ctx, ruleCtx) {
  switch (action?.kind) {
    case 'move':    return applyMove(action, ctx, ruleCtx);
    case 'sprint':  return applySprint(action, ctx, ruleCtx);
    case 'attack':  return applyAttack(action, ctx, ruleCtx);
    case 'respawn': return applyRespawn(ctx, ruleCtx);
    case 'plant':   return applyPlant(action, ctx, ruleCtx);
    case 'defuse':  return applyDefuse(action, ctx, ruleCtx);
    case 'pass':    return { ok: true, ctx, costPoints: 0 };

    case 'breach':  return applyBreach(action, ctx, ruleCtx);

    default: return { ok: false, reason: `unknown action kind: ${action?.kind}` };
  }
}

function resolveMineTriggers(enteredKeys, ctx, actorSide) {
  if (actorSide !== SIDE.attacker) {
    return { structures: ctx.structures, positions: ctx.positions, triggered: [] };
  }
  let structures = ctx.structures;
  let positions = ctx.positions;
  const triggered = [];
  const uuid = ctx.actor.uuid;

  for (const key of enteredKeys) {
    const s = structures[key];
    if (!s || s.kind !== 'mine') continue;
    if (structures === ctx.structures) structures = { ...structures };
    delete structures[key];
    const pos = positions[uuid];
    const newHp = Math.max(0, (pos.hp ?? PLAYER_MAX_HP) - MINE_DAMAGE);
    if (positions === ctx.positions) positions = { ...positions };
    positions[uuid] = { ...pos, hp: newHp, alive: newHp > 0 };
    triggered.push({ at: key, newHp });
    if (newHp <= 0) break;
  }
  return { structures, positions, triggered };
}

function applyMove(action, ctx, ruleCtx) {
  const v = validateMove(action.to, ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };
  const uuid = ctx.actor.uuid;
  let positions = {
    ...ctx.positions,
    [uuid]: { ...ctx.positions[uuid], q: action.to.q, r: action.to.r },
  };
  let structures = ctx.structures;

  const trig = resolveMineTriggers(
    [tileKey(action.to.q, action.to.r)],
    { ...ctx, positions, structures },
    ctx.actor.side,
  );
  structures = trig.structures;
  positions = trig.positions;

  return {
    ok: true,
    ctx: spend({ ...ctx, positions, structures }, v.costPoints),
    costPoints: v.costPoints,
    meta: trig.triggered.length ? { mineTriggered: trig.triggered } : undefined,
  };
}

function applySprint(action, ctx, ruleCtx) {
  const v = validateSprint(action.path || action.to, ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };
  const uuid = ctx.actor.uuid;
  const last = v.path[v.path.length - 1];
  let positions = {
    ...ctx.positions,
    [uuid]: { ...ctx.positions[uuid], q: last.q, r: last.r },
  };
  let structures = ctx.structures;

  const enteredKeys = v.path.map((p) => tileKey(p.q, p.r));
  const trig = resolveMineTriggers(enteredKeys, { ...ctx, positions, structures }, ctx.actor.side);
  structures = trig.structures;
  positions = trig.positions;

  if (positions[uuid].alive === false && trig.triggered.length) {
    const lastTrig = trig.triggered[trig.triggered.length - 1];
    const [dq, dr] = lastTrig.at.split(',').map(Number);
    positions = { ...positions, [uuid]: { ...positions[uuid], q: dq, r: dr } };
  }

  return {
    ok: true,
    ctx: spend({ ...ctx, positions, structures }, v.costPoints),
    costPoints: v.costPoints,
    meta: {
      pathLength: v.path.length,
      ...(trig.triggered.length ? { mineTriggered: trig.triggered } : {}),
    },
  };
}

function applyBreach(action, ctx, ruleCtx) {
  const v = validateBreach(action.target, ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };
  const key = tileKey(action.target.q, action.target.r);
  const current = ctx.structures[key];
  const nextHp = Math.max(0, current.hp - 60);
  const next = { ...current, hp: nextHp, visibleToAttacker: true };
  const structures = { ...ctx.structures };
  if (nextHp <= 0) {
    delete structures[key];
  } else {
    structures[key] = next;
  }
  return {
    ok: true,
    ctx: spend({ ...ctx, structures }, v.costPoints),
    costPoints: v.costPoints,
    meta: { target: action.target, destroyed: nextHp <= 0, remainingHp: nextHp },
  };
}

function applyAttack(action, ctx, ruleCtx) {
  const v = validateAttackPlayer(action.targetUUID, ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };
  const targetPos = ctx.positions[action.targetUUID];
  const nextHp = Math.max(0, (targetPos.hp ?? PLAYER_MAX_HP) - PLAYER_ATTACK_DAMAGE);
  const nextAlive = nextHp > 0;
  const positions = {
    ...ctx.positions,
    [action.targetUUID]: { ...targetPos, hp: nextHp, alive: nextAlive },
  };
  return {
    ok: true,
    ctx: spend(withPositions(ctx, positions), v.costPoints),
    costPoints: v.costPoints,
    meta: { killed: !nextAlive, targetHp: nextHp, targetUUID: action.targetUUID },
  };
}

function applyRespawn(ctx, ruleCtx) {
  const v = validateRespawn(ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };

  const zone = ctx.spawnKeys?.[ctx.actor.side] || [];
  let spawn = null;
  if (zone.length) {
    const idx = Math.floor((ctx.rng ? ctx.rng() : Math.random()) * zone.length);
    const [q, r] = zone[idx].split(',').map(Number);
    spawn = { q, r };
  } else {
    const pos = ctx.positions[ctx.actor.uuid] || { q: 0, r: 0 };
    spawn = { q: pos.q, r: pos.r };
  }

  const positions = {
    ...ctx.positions,
    [ctx.actor.uuid]: { q: spawn.q, r: spawn.r, hp: PLAYER_MAX_HP, alive: true },
  };
  return {
    ok: true,
    ctx: spend(withPositions(ctx, positions), v.costPoints),
    costPoints: v.costPoints,
    meta: { spawnedAt: spawn },
  };
}

function applyPlant(action, ctx, ruleCtx) {
  const v = validatePlant(action.site, ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };

  const site = ctx.sites[action.site];
  const defenderUUIDs = [];
  for (const [uuid, side] of Object.entries(ctx.teamSideByUUID || {})) {
    if (side === SIDE.defender) defenderUUIDs.push(uuid);
  }

  const result = transitionBomb(site, ctx.armedBombs?.[action.site] || null, {
    kind: 'plant',
    actorUUID: ctx.actor.uuid,
    matchMs: ctx.matchMs,
    defenderUUIDs,
  });

  const nextSites = { ...ctx.sites, [action.site]: result.site };
  const nextArmed = { ...ctx.armedBombs, [action.site]: result.armedBomb };
  const nextCtx = spend(
    { ...ctx, sites: nextSites, armedBombs: nextArmed },
    v.costPoints,
  );
  return {
    ok: true,
    ctx: nextCtx,
    costPoints: v.costPoints,
    meta: { siteId: action.site, effects: result.effects, siteOutcome: null },
  };
}

function applyDefuse(action, ctx, ruleCtx) {
  const v = validateDefuse(action.site, ruleCtx);
  if (!v.ok) return { ok: false, reason: v.reason };

  const site = ctx.sites[action.site];
  const result = transitionBomb(site, ctx.armedBombs?.[action.site] || null, {
    kind: 'defuse',
    actorUUID: ctx.actor.uuid,
    matchMs: ctx.matchMs,
    halfNumber: ctx.halfNumber,
  });

  const nextSites = { ...ctx.sites, [action.site]: result.site };
  const nextArmed = { ...ctx.armedBombs, [action.site]: null };
  const nextSiteOutcomes = result.siteOutcome
    ? [...(ctx.siteOutcomes || []), { ...result.siteOutcome, half: ctx.halfNumber }]
    : ctx.siteOutcomes;
  const nextCtx = spend(
    { ...ctx, sites: nextSites, armedBombs: nextArmed, siteOutcomes: nextSiteOutcomes },
    v.costPoints,
  );
  return {
    ok: true,
    ctx: nextCtx,
    costPoints: v.costPoints,
    meta: {
      siteId: action.site,
      effects: result.effects,
      siteOutcome: result.siteOutcome,
      expiresAtMatchMs: result.effects?.[0]?.expiresAtMatchMs,
      remainingMs: result.effects?.[0]?.expiresAtMatchMs - ctx.matchMs,
    },
  };
}

// ── Tick resolution ───────────────────────────────────────────────

/**
 * Deterministic tick (spec §3.6). Input:
 *   {
 *     matchMs, halfNumber, halfStartMs, halfEndMs,
 *     state:   { tiles, structures, positions, sites, points, pointsSpent },
 *     playback: Record<uuid, GhostPlaybackWindow>,
 *     ghostSides: Record<uuid, side>,
 *     teamSideByUUID,
 *     spawnKeys, rng,
 *     teamPlanner: REQUIRED — (input) => { [uuid]: Action[] }
 *     behaviorProfiles?,
 *   }
 *
 * Returns { state, playback, events }.
 *
 * Throws if `teamPlanner` is not provided. There is no built-in fallback —
 * the callsite (typically BreachArena, and the training env) must pass
 * `breachDescriptor.teamPlanner` explicitly.
 */
export function resolveTick(input) {
  if (typeof input?.teamPlanner !== 'function') {
    throw new Error(
      'resolveTick: input.teamPlanner is required. '
      + 'Pass breachDescriptor.teamPlanner from the caller.',
    );
  }

  let state = input.state;
  const events = [];

  // Step 1 — clock events.
  if (state.sites && state.armedBombs) {
    const swept = tickAllBombs(state.sites, state.armedBombs, input.matchMs, input.halfNumber);
    if (swept.effects.length) {
      state = {
        ...state,
        sites: swept.sites,
        armedBombs: swept.armedBombs,
        siteOutcomes: [...(state.siteOutcomes || []), ...swept.outcomes],
      };
      for (const eff of swept.effects) events.push({ ...eff, source: 'clock' });
    }
  }

  // Step 2 — human action: arena-driven, not here.

  // Step 3 — playback unlocks.
  const updatedPlayback = { ...input.playback };
  const freshTurnGhosts = [];
  for (const [uuid, win] of Object.entries(input.playback || {})) {
    const { unlocked, nextCursor, pointsUnlocked } = advanceCursor(win, input.matchMs);
    if (unlocked.length === 0) continue;
    updatedPlayback[uuid] = { ...win, nextCompletionCursor: nextCursor };
    const points = { ...state.points, [uuid]: (state.points[uuid] || 0) + pointsUnlocked };
    state = { ...state, points };
    freshTurnGhosts.push({
      uuid,
      lastOffsetMs: unlocked[unlocked.length - 1].completionOffsetMs,
    });
    events.push({ type: 'unlock', actor: uuid, pointsUnlocked, unlockedCount: unlocked.length });
  }

  // Step 4 — ghost turns.
  //
  // The team planner sees full match state for its side and returns a plan
  // for every acting ghost. Point budgets remain PER-GHOST — the planner
  // proposes actions; each plan still runs through runTurn, which validates
  // affordability against that specific ghost's `points` entry. No pooling.
  freshTurnGhosts.sort((a, b) => {
    if (a.lastOffsetMs !== b.lastOffsetMs) return a.lastOffsetMs - b.lastOffsetMs;
    return a.uuid.localeCompare(b.uuid);
  });

  const plansByGhost = buildTeamPlans(input.teamPlanner, freshTurnGhosts, state, input);

  for (const { uuid } of freshTurnGhosts) {
    const side = input.ghostSides[uuid];
    if (!side) continue;

    const plan = plansByGhost[uuid] || [];
    if (plan.length === 0) {
      events.push({ type: 'ghost-turn', actor: uuid, applied: [], rejected: null });
      continue;
    }

    const turnCtx = {
      tiles: state.tiles,
      structures: state.structures || {},
      positions: state.positions,
      sites: state.sites,
      armedBombs: state.armedBombs || {},
      siteOutcomes: state.siteOutcomes || [],
      points: state.points,
      pointsSpent: state.pointsSpent,
      actor: { uuid, side },
      teamSideByUUID: input.teamSideByUUID,
      spawnKeys: input.spawnKeys,
      rng: input.rng,
      matchMs: input.matchMs,
      halfNumber: input.halfNumber,
    };
    const outcome = runTurn(plan, turnCtx);
    state = outcome.state;
    events.push({
      type: 'ghost-turn',
      actor: uuid,
      applied: outcome.applied,
      rejected: outcome.rejected,
    });
  }

  return { state, playback: updatedPlayback, events };
}

/**
 * Invoke the team planner once per side that has at least one acting ghost,
 * and return a flat { uuid: Action[] } map covering every acting ghost.
 */
function buildTeamPlans(teamPlanner, freshTurnGhosts, state, input) {
  const out = {};
  if (freshTurnGhosts.length === 0) return out;

  const actingBySide = { attacker: [], defender: [] };
  for (const g of freshTurnGhosts) {
    const side = input.ghostSides[g.uuid];
    if (side && actingBySide[side]) actingBySide[side].push({ uuid: g.uuid });
  }

  for (const side of ['attacker', 'defender']) {
    if (actingBySide[side].length === 0) continue;

    const members = buildSideMembers(side, state, input);
    const enemies = buildSideEnemies(side, state, input);
    const armedBombsView = {};
    for (const [siteId, entry] of Object.entries(state.armedBombs || {})) {
      if (entry) {
        armedBombsView[siteId] = {
          armedAtMatchMs: entry.armedAtMatchMs,
          expiresAtMatchMs: entry.expiresAtMatchMs,
          defenderResponseAvailable: entry.defenderResponseAvailable,
        };
      }
    }

    let plans = {};
    try {
      plans = teamPlanner({
        side,
        actingGhosts: actingBySide[side],
        members,
        enemies,
        map: {
          tiles: state.tiles,
          sites: state.sites,
          structures: state.structures || {},
        },
        armedBombs: armedBombsView,
        clock: {
          matchMs: input.matchMs,
          halfNumber: input.halfNumber,
          halfStartMs: input.halfStartMs,
          halfEndMs: input.halfEndMs,
          timeLeftInHalf: Math.max(0, (input.halfEndMs || 0) - input.matchMs),
        },
        costs: costsForSide(side),
      }) || {};
    } catch {
      plans = {};
    }
    for (const [uuid, plan] of Object.entries(plans)) {
      out[uuid] = Array.isArray(plan) ? plan : [];
    }
  }

  return out;
}

function buildSideMembers(side, state, input) {
  const members = [];
  for (const [uuid, side2] of Object.entries(input.teamSideByUUID || {})) {
    if (side2 !== side) continue;
    if (!input.ghostSides[uuid]) continue;

    const pos = state.positions[uuid] || { q: 0, r: 0, hp: PLAYER_MAX_HP, alive: true };
    const responseWindowFor = [];
    if (side === SIDE.defender && state.armedBombs) {
      for (const [siteId, entry] of Object.entries(state.armedBombs)) {
        if (entry?.defenderResponseAvailable?.[uuid]) responseWindowFor.push(siteId);
      }
    }
    members.push({
      uuid,
      position: { q: pos.q, r: pos.r },
      hp: pos.hp ?? PLAYER_MAX_HP,
      alive: pos.alive !== false,
      points: state.points[uuid] || 0,
      responseWindowFor,
      behaviorProfile: input.behaviorProfiles?.[uuid] || null,
    });
  }
  return members;
}

function buildSideEnemies(side, state, input) {
  const teammateAnchors = [];
  for (const [uuid, side2] of Object.entries(input.teamSideByUUID || {})) {
    if (side2 !== side) continue;
    const pos = state.positions[uuid];
    if (!pos || pos.alive === false) continue;
    teammateAnchors.push({ q: pos.q, r: pos.r });
  }

  const enemies = [];
  for (const [uuid, side2] of Object.entries(input.teamSideByUUID || {})) {
    if (side2 === side) continue;
    const pos = state.positions[uuid];
    if (!pos || pos.alive === false) continue;
    const visible = teammateAnchors.some(
      (a) => hexDist(a.q, a.r, pos.q, pos.r) <= ENEMY_VISIBILITY_RADIUS,
    );
    if (!visible) continue;
    enemies.push({
      uuid,
      position: { q: pos.q, r: pos.r },
      hp: pos.hp ?? PLAYER_MAX_HP,
      alive: true,
    });
  }
  return enemies;
}
