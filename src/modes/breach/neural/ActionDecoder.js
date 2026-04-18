/**
 * Action decoder for the breach Neural Team Planner.
 *
 * Converts policy-head logits into concrete Action objects the resolver
 * understands. Works in two stages:
 *
 *   1. Build a per-ghost LEGALITY MASK for each of the policy's three heads
 *      (primary, direction, sprintLen). The mask encodes every constraint
 *      rules.js enforces: affordability, adjacency, target liveness, site
 *      state, response windows, etc.
 *
 *   2. Sample a legal action by picking from the head logits subject to the
 *      mask — argmax for the shipping game (determinism), softmax sampling
 *      during training (exploration).
 *
 * The mask is the contract that keeps a learned policy honest. Even a
 * totally wild network — every sign flipped, every bias huge — can only
 * ever emit actions the rules would accept, because it's literally
 * impossible for an illegal head index to be chosen. That means the arena
 * never rejects a planned action at runtime and the ghost never wastes a
 * turn to a rule failure.
 *
 * ── Exports ───────────────────────────────────────────────────────
 *
 *   buildMask(actorUUID, snap)       → { primary, direction[6], sprintLen[3] }
 *   decodeAction(logits, mask, actor,
 *                snap, pickFn)       → Action | null
 *
 * where `pickFn(logits, mask)` returns an index or -1 and is either
 * `maskedArgmax` (deploy) or a curried `maskedSample(..., rng, temp)` (train).
 */

import { hexDist, tileKey, inBounds } from '../../../engine/hex.js';
import { SIDE } from '../Constants.js';
import {
  PRIMARY, PRIMARY_DIM, DIRECTION_DIM, SPRINT_LEN_DIM, SPRINT_LENGTHS,
} from './Network.js';
import { neighborsInOrder } from './Observation.js';

// ── Mask building ─────────────────────────────────────────────────

/**
 * Build legality masks for one acting ghost. Mask entries are booleans; true
 * = permitted, false = forbidden. `snap` is the cloned snapshot the planner
 * builds per tick (see NeuralTeamPlanner.js).
 */
export function buildMask(actorUUID, snap) {
  const primary   = new Array(PRIMARY_DIM).fill(false);
  const direction = new Array(DIRECTION_DIM).fill(false);
  const sprintLen = new Array(SPRINT_LEN_DIM).fill(false);

  const self = snap.byUUID[actorUUID];
  if (!self) {
    primary[PRIMARY.WAIT] = true;    // no self found → only legal move is pass
    return { primary, direction, sprintLen };
  }

  // WAIT is always legal — gives the policy a safe default.
  primary[PRIMARY.WAIT] = true;

  const costs = snap.costs || {};
  const sites = snap.map?.sites || {};
  const structures = snap.map?.structures || {};
  const tiles = snap.map?.tiles || {};

  // ── RESPAWN (dead actor only) ───────────────────────────────────
  if (!self.alive) {
    if ((self.points || 0) >= (costs.respawn || Infinity)) primary[PRIMARY.RESPAWN] = true;
    return { primary, direction, sprintLen };   // dead ghosts can't do anything else
  }

  // ── MOVE / SPRINT: compute per-direction passability ────────────
  // A direction d is MOVE-legal iff the neighbor tile is passable and the
  // ghost can afford 1 move. SPRINT-legal iff at least 2 straight steps in
  // that direction are passable and affordable.
  const neighbors = neighborsInOrder(self.position.q, self.position.r);
  const moveCost = costs.move || Infinity;
  const canAffordMove1 = (self.points || 0) >= moveCost;

  // Per-direction ray length check: how many straight steps can we sprint?
  const sprintableLen = new Array(DIRECTION_DIM).fill(0);
  for (let d = 0; d < DIRECTION_DIM; d += 1) {
    const nb = neighbors[d];
    if (!inBounds(nb.q, nb.r)) continue;
    if (!isPassable(nb, self, snap)) continue;
    direction[d] = canAffordMove1;    // direction legal for a single move

    // Extend in same hex axis by one more hex per step. Use a cube-delta
    // derived from the first neighbor so the sprint remains colinear with
    // the direction index.
    let cq = nb.q, cr = nb.r;
    let reach = 1;
    for (let s = 2; s <= SPRINT_LENGTHS[SPRINT_LEN_DIM - 1]; s += 1) {
      const nextRing = neighborsInOrder(cq, cr);
      // Pick the neighbor that maintains direction `d` — computed by matching
      // the (q-self.q, r-self.r) vector's angle. We use getStraightLinePath-
      // style axis preservation: check each candidate for colinearity.
      const wanted = continueRay(self.position, neighbors[d], s);
      if (!wanted || !inBounds(wanted.q, wanted.r)) break;
      if (!isPassable(wanted, self, snap)) break;
      cq = wanted.q; cr = wanted.r; reach = s;
    }
    sprintableLen[d] = reach;
  }

  if (direction.some(Boolean)) {
    primary[PRIMARY.MOVE] = canAffordMove1;
  }

  // SPRINT head: sprintLen[i] is legal iff SOME direction reaches at least
  // SPRINT_LENGTHS[i] hexes AND the ghost can afford that many moves.
  let anySprintLegal = false;
  for (let i = 0; i < SPRINT_LEN_DIM; i += 1) {
    const wantLen = SPRINT_LENGTHS[i];
    const canReach = sprintableLen.some((r) => r >= wantLen);
    const canAfford = (self.points || 0) >= moveCost * wantLen;
    sprintLen[i] = canReach && canAfford;
    if (sprintLen[i]) anySprintLegal = true;
  }
  // For SPRINT primary we need at least one direction that can do the
  // minimum length (2) AND one length bucket that's affordable.
  if (anySprintLegal && sprintableLen.some((r) => r >= SPRINT_LENGTHS[0])) {
    primary[PRIMARY.SPRINT] = true;
  }

  // ── ATTACK: must have a living adjacent enemy, affordable ───────
  const attackCost = costs.attackPlayer ?? Infinity;
  let adjEnemy = null;
  if ((self.points || 0) >= attackCost) {
    for (const e of snap.enemies || []) {
      if (!e.alive) continue;
      if (hexDist(self.position.q, self.position.r, e.position.q, e.position.r) === 1) {
        if (!adjEnemy || e.hp < adjEnemy.hp) adjEnemy = e;
      }
    }
    if (adjEnemy) primary[PRIMARY.ATTACK] = true;
  }

  // ── PLANT (attacker on idle site tile, affordable) ──────────────
  if (self.side === SIDE.attacker && (self.points || 0) >= (costs.plant ?? Infinity)) {
    for (const [id, s] of Object.entries(sites)) {
      if (!s) continue;
      if (s.state !== 'idle') continue;
      if (s.position.q === self.position.q && s.position.r === self.position.r) {
        primary[PRIMARY.PLANT] = true;
        break;
      }
    }
  }

  // ── DEFUSE (defender on/adj armed site with open window, affordable) ─
  if (self.side === SIDE.defender && (self.points || 0) >= (costs.defuse ?? Infinity)) {
    for (const [id, s] of Object.entries(sites)) {
      if (!s || s.state !== 'armed') continue;
      const armed = snap.armedBombs?.[id];
      if (!armed) continue;
      if (!armed.defenderResponseAvailable?.[actorUUID]) continue;
      const d = hexDist(self.position.q, self.position.r, s.position.q, s.position.r);
      if (d <= 1) { primary[PRIMARY.DEFUSE] = true; break; }
    }
  }

  return { primary, direction, sprintLen };
}

/**
 * Return the tile that is `steps` hexes from `origin` in the same direction
 * as the first step `firstStep`. Uses the cube-delta of the first step and
 * scales it. Works only for strictly colinear rays — used for sprint extension.
 */
function continueRay(origin, firstStep, steps) {
  // Convert origin+firstStep to cube, derive dir, scale.
  const a = offsetToCube(origin.q, origin.r);
  const b = offsetToCube(firstStep.q, firstStep.r);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Scale by `steps` (step-0 is origin, step-1 is firstStep, step-N is wanted).
  const rx = a.x + dx * steps;
  const rz = a.z + dz * steps;
  return cubeToOffset(rx, rz);
}
function offsetToCube(q, r) {
  const x = q - (r - (r & 1)) / 2;
  return { x, y: -x - r, z: r };
}
function cubeToOffset(x, z) {
  const r = z;
  return { q: x + (r - (r & 1)) / 2, r };
}

function isPassable(pos, self, snap) {
  const k = tileKey(pos.q, pos.r);
  const tile = snap.map?.tiles?.[k];
  if (!tile || tile.type === 'mountain') return false;
  const s = snap.map?.structures?.[k];
  if (s && (s.kind === 'wall' || s.kind === 'reinforced_wall') && s.hp > 0) return false;
  // Enemy occupancy blocks (teammate stacking is allowed).
  for (const e of snap.enemies || []) {
    if (e.alive && e.position.q === pos.q && e.position.r === pos.r) return false;
  }
  return true;
}

// ── Action decoding ───────────────────────────────────────────────

/**
 * Decode the net's logits into a concrete Action object.
 *
 * `pickFn(logits, mask)` is the sampler: maskedArgmax at game time,
 * maskedSample at training time. Returns -1 if no legal option exists, in
 * which case we fall back to a pass.
 */
export function decodeAction(logits, mask, actorUUID, snap, pickFn) {
  const self = snap.byUUID[actorUUID];
  if (!self) return { kind: 'pass' };

  const primary = pickFn(logits.primary, mask.primary);
  if (primary < 0 || primary === PRIMARY.WAIT) return { kind: 'pass' };

  const costs = snap.costs || {};
  const sites = snap.map?.sites || {};
  const neighbors = neighborsInOrder(self.position.q, self.position.r);

  switch (primary) {
    case PRIMARY.MOVE: {
      const d = pickFn(logits.direction, mask.direction);
      if (d < 0) return { kind: 'pass' };
      return { kind: 'move', to: neighbors[d] };
    }
    case PRIMARY.SPRINT: {
      // Intersect direction mask with the lengths the net wants to attempt.
      // We pick a length first; then restrict direction mask to directions
      // that actually reach that length.
      const lenIdx = pickFn(logits.sprintLen, mask.sprintLen);
      if (lenIdx < 0) return { kind: 'pass' };
      const wantLen = SPRINT_LENGTHS[lenIdx];
      // Rebuild a direction sub-mask matching wantLen.
      const subMask = new Array(DIRECTION_DIM).fill(false);
      for (let dir = 0; dir < DIRECTION_DIM; dir += 1) {
        if (!mask.direction[dir]) continue;
        // Re-compute reach for this direction — cheap.
        let reach = 1, cur = neighbors[dir];
        if (!isPassable(cur, self, snap)) continue;
        for (let s = 2; s <= wantLen; s += 1) {
          const nxt = continueRay(self.position, neighbors[dir], s);
          if (!nxt || !inBounds(nxt.q, nxt.r)) break;
          if (!isPassable(nxt, self, snap)) break;
          reach = s;
        }
        if (reach >= wantLen) subMask[dir] = true;
      }
      const d = pickFn(logits.direction, subMask);
      if (d < 0) return { kind: 'pass' };
      // Build the path array the resolver expects.
      const path = [];
      for (let s = 1; s <= wantLen; s += 1) {
        path.push(continueRay(self.position, neighbors[d], s));
      }
      return { kind: 'sprint', path };
    }
    case PRIMARY.ATTACK: {
      // Pick the adjacent enemy with the lowest HP — same heuristic the
      // rule-based planner used, deterministic tiebreak by UUID. The net
      // doesn't choose which enemy; it just decides WHEN to attack.
      let target = null;
      for (const e of snap.enemies || []) {
        if (!e.alive) continue;
        if (hexDist(self.position.q, self.position.r, e.position.q, e.position.r) !== 1) continue;
        if (!target
          || e.hp < target.hp
          || (e.hp === target.hp && e.uuid.localeCompare(target.uuid) < 0)) {
          target = e;
        }
      }
      if (!target) return { kind: 'pass' };
      return { kind: 'attack', targetUUID: target.uuid };
    }
    case PRIMARY.PLANT: {
      for (const [id, s] of Object.entries(sites)) {
        if (s?.state === 'idle'
          && s.position.q === self.position.q
          && s.position.r === self.position.r) {
          return { kind: 'plant', site: id };
        }
      }
      return { kind: 'pass' };
    }
    case PRIMARY.DEFUSE: {
      // Pick the most-expiring armed site we're on/adj to with an open window.
      let best = null;
      for (const [id, s] of Object.entries(sites)) {
        if (!s || s.state !== 'armed') continue;
        const armed = snap.armedBombs?.[id];
        if (!armed?.defenderResponseAvailable?.[actorUUID]) continue;
        if (hexDist(self.position.q, self.position.r, s.position.q, s.position.r) > 1) continue;
        if (!best || armed.expiresAtMatchMs < best.expiresAtMatchMs) {
          best = { id, expiresAtMatchMs: armed.expiresAtMatchMs };
        }
      }
      if (!best) return { kind: 'pass' };
      return { kind: 'defuse', site: best.id };
    }
    case PRIMARY.RESPAWN:
      return { kind: 'respawn' };

    default:
      return { kind: 'pass' };
  }
}
