import {
  getNeighbors, inBounds, tileKey, parseKey,
  TILE_HP, TILE_DAMAGE, REINFORCE_MULT,
} from './MapGen.js';
import { getGhostScore } from './Match.js';
import { defaultProfile } from './BehaviorProfile.js';

export const GHOST_TICK_MS = 25_000;

// ── Cost helpers (all scaled by d = durationHours / 4) ───────────

export function scaledCost(base, d) { return Math.max(1, Math.round(base * d)); }

export function getMoveCost(d)       { return scaledCost(4, d); }
export function getClaimCost(d)      { return scaledCost(15, d); }
export function getAttackTileCost(d) { return scaledCost(20, d); }
export function getAttackTowerCost(d){ return scaledCost(25, d); }
export function getReinforceCost(tier, d) {
  return scaledCost([20, 50, 100][tier] ?? 100, d);
}
export function getPlayerAttackCost(d) { return scaledCost(15, d); }

// ── Burst cost multiplier (human player only, not ghosts) ─────────

export function burstMultiplier(spent) {
  if (spent < 60)  return 1.0;
  if (spent < 120) return 1.2;
  if (spent < 200) return 1.5;
  return 2.0;
}

// ── Pathfinding toward nearest frontier via owned tiles ───────────

function findFrontierStep(tiles, sq, sr, team) {
  const enemy = team === 'team1' ? 'team2' : 'team1';
  const visited = new Set([tileKey(sq, sr)]);
  const queue = [{ q: sq, r: sr, first: null }];

  while (queue.length) {
    const { q, r, first } = queue.shift();
    for (const { q: nq, r: nr } of getNeighbors(q, r)) {
      if (!inBounds(nq, nr)) continue;
      const key = tileKey(nq, nr);
      if (visited.has(key)) continue;
      visited.add(key);

      const t = tiles[key];
      if (!t || t.type === 'mountain') continue;
      const step = first ?? { q: nq, r: nr };

      if (t.owner === enemy || !t.owner) return step;
      if (t.owner === team) queue.push({ q: nq, r: nr, first: step });
    }
  }
  return null;
}

// ── Main ghost tick ───────────────────────────────────────────────

/**
 * Computes a single action for one ghost player this tick.
 * Returns an action object { type, q, r, cost, ... } or null.
 */
export function tickGhost(ghost, tiles, playerPositions, pointsSpent, matchCreatedAt, durationHours) {
  const d  = durationHours / 4;
  const team  = ghost.team;
  const enemy = team === 'team1' ? 'team2' : 'team1';
  const profile = ghost.behaviorProfile ?? defaultProfile(ghost);

  const pos = playerPositions[ghost.UUID];
  if (!pos || !inBounds(pos.q, pos.r)) return null;
  const { q, r } = pos;

  // Budget for this tick: spend up to ~12% of unspent per tick (creates natural cadence)
  const totalEarned = getGhostScore(ghost, matchCreatedAt, durationHours);
  const unspent = Math.max(0, totalEarned - (pointsSpent[ghost.UUID] || 0));
  const tickBudget = Math.min(unspent, Math.max(getMoveCost(d), unspent * 0.12 + getMoveCost(d)));

  if (tickBudget <= 0) return null;

  // Score candidate actions
  const candidates = [];

  for (const { q: nq, r: nr } of getNeighbors(q, r)) {
    if (!inBounds(nq, nr)) continue;
    const t = tiles[tileKey(nq, nr)];
    if (!t || t.type === 'mountain') continue;

    if (t.isTower && t.owner === enemy) {
      candidates.push({ type: 'attack_tower', q: nq, r: nr, cost: getAttackTowerCost(d), score: profile.aggression + 0.3 });
    } else if (t.owner === enemy) {
      candidates.push({ type: 'attack_tile', q: nq, r: nr, cost: getAttackTileCost(d), score: profile.aggression * 0.85 + 0.1 });
    } else if (!t.owner) {
      // Claim unclaimed — strong opening preference; scales with expansion
      candidates.push({ type: 'claim', q: nq, r: nr, cost: getClaimCost(d), score: 0.55 + profile.expansion * 0.4 });
    } else if (t.owner === team) {
      // Move onto friendly — baseline plus expansion desire so explorers roam
      candidates.push({ type: 'move', q: nq, r: nr, cost: getMoveCost(d), score: 0.2 + profile.expansion * 0.15 });
    }
  }

  // Reinforce current tile — but weight tier-0 (starting) reinforce down
  // so ghosts don't blow their opening move fortifying their own tower
  // instead of exploring. Upgraded tiers are fine once tile is under threat.
  const cur = tiles[tileKey(q, r)];
  if (cur?.owner === team && cur.reinforceTier < 3) {
    const tier = cur.reinforceTier;
    const baseScore = tier === 0
      ? profile.defense * 0.35            // timid opening, beats move only if truly defensive
      : profile.defense * (0.8 - tier * 0.2);
    candidates.push({
      type: 'reinforce', q, r, tier: tier + 1,
      cost: getReinforceCost(tier, d),
      score: baseScore,
    });
  }

  // Pick best affordable action
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (c.cost <= tickBudget) return c;
  }

  // Nothing adjacent — move toward frontier
  if (tickBudget >= getMoveCost(d)) {
    const step = findFrontierStep(tiles, q, r, team);
    if (step) {
      const stepTile = tiles[tileKey(step.q, step.r)];
      if (stepTile?.owner === team) {
        return { type: 'move', q: step.q, r: step.r, cost: getMoveCost(d) };
      }
    }
  }

  return null;
}

// ── Apply action to map state ─────────────────────────────────────

/**
 * Applies a single ghost action, returning new (shallow-cloned) state slices.
 * Does NOT mutate the originals.
 */
export function applyAction(action, tiles, playerPositions, pointsSpent, actorUUID) {
  if (!action) return { tiles, playerPositions, pointsSpent };

  const newTiles    = { ...tiles };
  const newPos      = { ...playerPositions };
  const newSpent    = { ...pointsSpent, [actorUUID]: (pointsSpent[actorUUID] || 0) + action.cost };
  const key         = tileKey(action.q, action.r);
  const actorTeam   = playerPositions[actorUUID]?.team;

  switch (action.type) {
    case 'move': {
      newPos[actorUUID] = { ...playerPositions[actorUUID], q: action.q, r: action.r };
      break;
    }
    case 'claim': {
      const tile = { ...newTiles[key] };
      tile.hp = Math.max(0, tile.hp - TILE_DAMAGE.claim);
      if (tile.hp <= 0) {
        tile.owner = actorTeam;
        tile.hp    = TILE_HP.claimed;
        tile.maxHp = TILE_HP.claimed;
        newPos[actorUUID] = { ...playerPositions[actorUUID], q: action.q, r: action.r };
      }
      newTiles[key] = tile;
      break;
    }
    case 'attack_tile': {
      const tile = { ...newTiles[key] };
      tile.hp = Math.max(0, tile.hp - TILE_DAMAGE.enemy);
      if (tile.hp <= 0) {
        tile.owner        = actorTeam;
        tile.hp           = TILE_HP.claimed;
        tile.maxHp        = TILE_HP.claimed;
        tile.reinforceTier = 0;
        newPos[actorUUID] = { ...playerPositions[actorUUID], q: action.q, r: action.r };
      }
      newTiles[key] = tile;
      break;
    }
    case 'attack_tower': {
      const tile = { ...newTiles[key] };
      tile.hp = Math.max(0, tile.hp - TILE_DAMAGE.tower);
      if (tile.hp <= 0) {
        tile.isTower       = false;
        tile.owner         = actorTeam;
        tile.hp            = TILE_HP.claimed;
        tile.maxHp         = TILE_HP.claimed;
        tile.reinforceTier = 0;
        newPos[actorUUID]  = { ...playerPositions[actorUUID], q: action.q, r: action.r };
      }
      newTiles[key] = tile;
      break;
    }
    case 'reinforce': {
      const tile = { ...newTiles[key] };
      tile.reinforceTier = action.tier;
      tile.maxHp = Math.round(TILE_HP.claimed * (REINFORCE_MULT[action.tier] ?? 1));
      tile.hp    = Math.min(tile.hp + Math.round(TILE_HP.claimed * 0.5), tile.maxHp);
      newTiles[key] = tile;
      break;
    }
    case 'attack_player': {
      // Attacking an enemy player on a tile
      if (playerPositions[action.targetUUID]) {
        const targetHp = Math.max(0, playerPositions[action.targetUUID].hp - 20);
        newPos[action.targetUUID] = { ...playerPositions[action.targetUUID], hp: targetHp };
      }
      break;
    }
    default: break;
  }

  return { tiles: newTiles, playerPositions: newPos, pointsSpent: newSpent };
}

// ── Combat: ghost attacks adjacent enemy players ──────────────────

export function applyProximityDamage(playerPositions, match) {
  const positions = { ...playerPositions };
  const team1UUIDs = new Set((match.teams?.[0] || []).map((p) => p.UUID));

  for (const [uuid, pos] of Object.entries(positions)) {
    const team = team1UUIDs.has(uuid) ? 'team1' : 'team2';
    const enemy = team === 'team1' ? 'team2' : 'team1';

    // Find enemies on the same tile
    const sameEnemies = Object.entries(positions).filter(([ouuid, opos]) => {
      if (ouuid === uuid) return false;
      const oTeam = team1UUIDs.has(ouuid) ? 'team1' : 'team2';
      return oTeam === enemy && opos.q === pos.q && opos.r === pos.r;
    });

    if (sameEnemies.length > 0) {
      positions[uuid] = { ...pos, hp: Math.max(0, pos.hp - 15 * sameEnemies.length) };
    }
  }
  return positions;
}
