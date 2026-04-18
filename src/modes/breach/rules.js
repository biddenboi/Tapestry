/**
 * Breach rules.
 *
 * Pure predicates and helpers that validate actions against match state.
 * No I/O, no React, no IndexedDB. Everything the rules need is passed in.
 *
 * For the load-bearing slice we validate:
 *   - move   (single hex)
 *   - sprint (multi-hex straight line)
 *   - attack (adjacent enemy player)
 *   - respawn
 *   - pass
 *
 * Plant/defuse/breach are declared but return `deferred: true` so callers
 * fail loudly if they try to use them before the bomb state machine lands.
 */

import {
  hexDist,
  inBounds,
  tileKey,
  getNeighbors,
  getStraightLinePath,
} from '../../engine/hex.js';
import {
  SIDE,
  ATTACK_PLAYER_COST,
  PLANT_COST,
  DEFUSE_COST,
  BREACH_WALL_COST,
  WALL_COST,
  REINFORCED_WALL_COST,
  MINE_COST,
  WALL_HP,
  REINFORCED_WALL_HP,
  DEFENDER_SETUP_BUDGET,
  DEFENDER_SETUP_RADIUS,
  PLAYER_MAX_HP,
  costsForSide,
} from './Constants.js';

// ── Path validity ─────────────────────────────────────────────────

/**
 * A tile is passable for movement iff:
 *   1. in bounds
 *   2. not a mountain
 *   3. no wall structure with hp > 0  (mines pass through but trigger on enter)
 *   4. not occupied by a living enemy (teammates don't block)
 */
export function isPassable(tile, tileStructure, tileOccupants, actorSide) {
  if (!tile || tile.type === 'mountain') return false;
  if (tileStructure) {
    if ((tileStructure.kind === 'wall' || tileStructure.kind === 'reinforced_wall')
      && tileStructure.hp > 0) {
      return false;
    }
    // Mines are explicitly passable — the applier handles the trigger.
  }
  if (tileOccupants && tileOccupants.length) {
    for (const occ of tileOccupants) {
      if (occ.alive && occ.side !== actorSide) return false;
    }
  }
  return true;
}

/**
 * Validate a single-step move. Returns { ok, reason?, costPoints? }.
 * `ctx` carries the current map state the rule needs.
 *
 *   ctx = {
 *     tiles, structures, positions,          // match.breach.mapState fields
 *     actor: { uuid, position, side, points, alive, hp },
 *     teamSideByUUID,                         // Record<uuid, side>
 *   }
 */
export function validateMove(target, ctx) {
  const { actor } = ctx;
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  if (!target || !Number.isInteger(target.q) || !Number.isInteger(target.r)) {
    return { ok: false, reason: 'bad target' };
  }
  if (!inBounds(target.q, target.r)) return { ok: false, reason: 'out of bounds' };

  const dist = hexDist(actor.position.q, actor.position.r, target.q, target.r);
  if (dist !== 1) return { ok: false, reason: 'not adjacent' };

  const tile = ctx.tiles[tileKey(target.q, target.r)];
  const structure = ctx.structures?.[tileKey(target.q, target.r)] || null;
  const occupants = occupantsAt(target, ctx);
  if (!isPassable(tile, structure, occupants, actor.side)) {
    return { ok: false, reason: 'blocked' };
  }

  const cost = costsForSide(actor.side).move;
  if (actor.points < cost) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: cost };
}

/**
 * Validate a multi-hex sprint along a straight line. Returns
 * { ok, reason?, costPoints?, path? }.
 */
export function validateSprint(targetOrPath, ctx) {
  const { actor } = ctx;
  if (!actor?.alive) return { ok: false, reason: 'dead' };

  let path;
  if (Array.isArray(targetOrPath)) {
    path = targetOrPath;
  } else if (targetOrPath && Number.isInteger(targetOrPath.q)) {
    path = getStraightLinePath(
      actor.position.q, actor.position.r,
      targetOrPath.q, targetOrPath.r,
    );
  }
  if (!path || path.length < 2) return { ok: false, reason: 'not a sprint target' };

  for (const step of path) {
    if (!inBounds(step.q, step.r)) return { ok: false, reason: 'out of bounds' };
    const tile = ctx.tiles[tileKey(step.q, step.r)];
    const structure = ctx.structures?.[tileKey(step.q, step.r)] || null;
    const occupants = occupantsAt(step, ctx);
    if (!isPassable(tile, structure, occupants, actor.side)) {
      return { ok: false, reason: 'path blocked' };
    }
  }

  const cost = costsForSide(actor.side).move * path.length;
  if (actor.points < cost) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: cost, path };
}

export function validateAttackPlayer(targetUUID, ctx) {
  const { actor } = ctx;
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  if (!targetUUID) return { ok: false, reason: 'no target' };

  const targetPos = ctx.positions?.[targetUUID];
  if (!targetPos?.alive) return { ok: false, reason: 'target not alive' };

  const targetSide = ctx.teamSideByUUID?.[targetUUID];
  if (targetSide === actor.side) return { ok: false, reason: 'friendly fire' };

  const dist = hexDist(actor.position.q, actor.position.r, targetPos.q, targetPos.r);
  if (dist > 1) return { ok: false, reason: 'out of range' };

  if (actor.points < ATTACK_PLAYER_COST) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: ATTACK_PLAYER_COST };
}

export function validateRespawn(ctx) {
  const { actor } = ctx;
  if (actor?.alive) return { ok: false, reason: 'already alive' };
  const cost = costsForSide(actor.side).respawn;
  if ((actor?.points || 0) < cost) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: cost };
}

// ── Plant / defuse / breach ───────────────────────────────────────

/**
 * Plant validity (spec §3.4 IDLE → ARMED guards).
 *   - actor alive, is attacker
 *   - actor on the site tile (exact match)
 *   - site.state === 'idle'
 *   - actor affords PLANT_COST
 * Response window initialization is the state machine's job, not ours.
 */
export function validatePlant(siteId, ctx) {
  const { actor, sites } = ctx;
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  if (actor.side !== SIDE.attacker) return { ok: false, reason: 'not attacker' };
  const site = sites?.[siteId];
  if (!site) return { ok: false, reason: `no site ${siteId}` };
  if (site.state !== 'idle') return { ok: false, reason: `site ${siteId} not idle (${site.state})` };
  if (actor.position.q !== site.position.q || actor.position.r !== site.position.r) {
    return { ok: false, reason: 'not on site tile' };
  }
  if (actor.points < PLANT_COST) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: PLANT_COST };
}

/**
 * Defuse validity (spec §3.4 ARMED → DEFUSED guards).
 *   - actor alive, is defender
 *   - actor on site tile OR adjacent
 *   - site.state === 'armed'
 *   - armedBombs entry exists for this site
 *   - defenderResponseAvailable[actor.uuid] === true
 *   - actor affords DEFUSE_COST
 */
export function validateDefuse(siteId, ctx) {
  const { actor, sites, armedBombs } = ctx;
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  if (actor.side !== SIDE.defender) return { ok: false, reason: 'not defender' };
  const site = sites?.[siteId];
  if (!site) return { ok: false, reason: `no site ${siteId}` };
  if (site.state !== 'armed') return { ok: false, reason: `site ${siteId} not armed (${site.state})` };
  const armed = armedBombs?.[siteId];
  if (!armed) return { ok: false, reason: `site ${siteId} has no armed bomb` };
  const d = hexDist(actor.position.q, actor.position.r, site.position.q, site.position.r);
  if (d > 1) return { ok: false, reason: 'not on or adjacent to site' };
  if (!armed.defenderResponseAvailable?.[actor.uuid]) {
    return { ok: false, reason: 'response window consumed' };
  }
  if (actor.points < DEFUSE_COST) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: DEFUSE_COST };
}

/**
 * Breach-wall validity.
 *   - actor alive, is attacker (defenders don't destroy their own walls)
 *   - target is adjacent
 *   - target has a wall structure with hp > 0
 *   - actor affords BREACH_WALL_COST
 * Deferred in the load-bearing slice (no structures placed yet), but the
 * validator is real for when setup phase lands.
 */
export function validateBreach(target, ctx) {
  const { actor, structures } = ctx;
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  if (actor.side !== SIDE.attacker) return { ok: false, reason: 'not attacker' };
  if (!target || !Number.isInteger(target.q)) return { ok: false, reason: 'bad target' };
  const d = hexDist(actor.position.q, actor.position.r, target.q, target.r);
  if (d !== 1) return { ok: false, reason: 'not adjacent' };
  const key = tileKey(target.q, target.r);
  const s = structures?.[key];
  if (!s) return { ok: false, reason: 'no structure on target' };
  if (s.kind !== 'wall' && s.kind !== 'reinforced_wall') {
    return { ok: false, reason: `cannot breach ${s.kind}` };
  }
  if (s.hp <= 0) return { ok: false, reason: 'wall already destroyed' };
  if (actor.points < BREACH_WALL_COST) return { ok: false, reason: 'insufficient points' };
  return { ok: true, costPoints: BREACH_WALL_COST };
}

// ── Helpers ────────────────────────────────────────────────────────

function occupantsAt(tile, ctx) {
  const k = tileKey(tile.q, tile.r);
  const out = [];
  const positions = ctx.positions || {};
  for (const [uuid, pos] of Object.entries(positions)) {
    if (tileKey(pos.q, pos.r) !== k) continue;
    if (uuid === ctx.actor?.uuid) continue;
    out.push({
      uuid,
      alive: pos.alive !== false,
      side: ctx.teamSideByUUID?.[uuid],
    });
  }
  return out;
}

/**
 * Adjacent-enemy helper for planner and popup — returns UUIDs of living
 * enemies within 1 hex of `from`.
 */
export function adjacentEnemies(from, side, ctx) {
  const neighbors = new Set(getNeighbors(from.q, from.r).map((nb) => tileKey(nb.q, nb.r)));
  neighbors.add(tileKey(from.q, from.r));
  const out = [];
  for (const [uuid, pos] of Object.entries(ctx.positions || {})) {
    if (!pos.alive) continue;
    if (ctx.teamSideByUUID?.[uuid] === side) continue;
    if (neighbors.has(tileKey(pos.q, pos.r))) out.push(uuid);
  }
  return out;
}

// ── Setup phase validators ────────────────────────────────────────

/**
 * Cost and HP lookup for structures.
 */
export const STRUCTURE_SPECS = Object.freeze({
  wall:            { cost: WALL_COST,            hp: WALL_HP },
  reinforced_wall: { cost: REINFORCED_WALL_COST, hp: REINFORCED_WALL_HP },
  mine:            { cost: MINE_COST,            hp: 1 },  // hp irrelevant but keep shape uniform
});

/**
 * Validate a single defender structure placement during setup.
 *
 * ctx = {
 *   tiles, sites, structures,
 *   spawnZones,               // { attacker: string[], defender: string[] }
 *   actor: { uuid, side },
 *   budgetRemaining: number,
 * }
 */
export function validatePlaceStructure(placement, ctx) {
  if (!placement || !placement.kind || !placement.at) {
    return { ok: false, reason: 'bad placement shape' };
  }
  if (ctx.actor?.side !== SIDE.defender) {
    return { ok: false, reason: 'only defenders can place' };
  }
  const spec = STRUCTURE_SPECS[placement.kind];
  if (!spec) return { ok: false, reason: `unknown structure kind: ${placement.kind}` };

  const { q, r } = placement.at;
  if (!Number.isInteger(q) || !Number.isInteger(r) || !inBounds(q, r)) {
    return { ok: false, reason: 'out of bounds' };
  }
  const tile = ctx.tiles?.[tileKey(q, r)];
  if (!tile || tile.type === 'mountain') {
    return { ok: false, reason: 'not a valid tile' };
  }
  // Site tiles themselves can't host structures — attackers need to stand on
  // them to plant.
  for (const site of Object.values(ctx.sites || {})) {
    if (site.position.q === q && site.position.r === r) {
      return { ok: false, reason: 'cannot place on site tile' };
    }
  }
  // No double-occupancy.
  if (ctx.structures?.[tileKey(q, r)]) {
    return { ok: false, reason: 'tile already has a structure' };
  }
  // Attacker spawn zone tiles are off-limits (would trap them at spawn).
  const atkZone = new Set(ctx.spawnZones?.attacker || []);
  if (atkZone.has(tileKey(q, r))) {
    return { ok: false, reason: 'cannot place on enemy spawn' };
  }
  // Must be within DEFENDER_SETUP_RADIUS of at least one site (spec §3.5).
  const inZone = Object.values(ctx.sites || {}).some(
    (s) => hexDist(s.position.q, s.position.r, q, r) <= DEFENDER_SETUP_RADIUS,
  );
  if (!inZone) return { ok: false, reason: 'not in placement zone' };

  if (spec.cost > (ctx.budgetRemaining || 0)) {
    return { ok: false, reason: 'insufficient budget' };
  }
  return { ok: true, cost: spec.cost, hp: spec.hp };
}

/**
 * Validate a starting-tile pick during setup. The tile must be in the actor's
 * side's spawn cluster. Teammate tile-sharing is allowed; spawn clusters are
 * small so overlap is expected.
 */
export function validateSetSpawn(tile, ctx) {
  if (!tile || !Number.isInteger(tile.q)) return { ok: false, reason: 'bad tile' };
  const zone = new Set(ctx.spawnZones?.[ctx.actor.side] || []);
  if (!zone.has(tileKey(tile.q, tile.r))) {
    return { ok: false, reason: 'not in own spawn zone' };
  }
  return { ok: true };
}

/**
 * Defender-setup budget accessor.
 */
export function setupBudget() {
  return DEFENDER_SETUP_BUDGET;
}

export { PLAYER_MAX_HP };
