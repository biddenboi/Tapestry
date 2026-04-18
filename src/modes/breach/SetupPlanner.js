/**
 * Breach setup-phase planner.
 *
 * Pure function conforming to spec §3.7's decideSetup contract. Given a
 * snapshot of the setup-phase world, returns a complete placement plan +
 * starting tile. No I/O, no match-state mutation — the arena validates the
 * returned plan and applies it atomically.
 *
 * Input shape (spec §3.7):
 *   {
 *     self: {
 *       uuid, side, behaviorProfile,
 *       budget,                  // remaining after own prior placements
 *     },
 *     map: { tiles, sites, spawnZones },    // spawnZones keyed by side
 *     teammates: [                          // already-committed teammate plans
 *       { uuid, structures: [{ kind, at }], startingTile },
 *     ],
 *   }
 *
 * Output:
 *   {
 *     structures: [{ kind, at: { q, r } }],
 *     startingTile: { q, r },
 *   }
 *
 * Strategy:
 *   - Attackers pick a non-overlapping spawn tile from their cluster.
 *   - Defenders pick a spawn tile, then anchor to a site (UUID-hashed so the
 *     three defenders spread across A/B/C). Place walls on the nearest
 *     approach tiles adjacent to the site (chokepoints) and mines a few
 *     hexes out along the main approach corridor (trap zone). Profile tunes
 *     the wall/mine split — aggressive profiles favor mines, defensive
 *     profiles favor reinforced walls.
 */

import {
  hexDist,
  inBounds,
  tileKey,
  getNeighbors,
} from '../../engine/hex.js';
import {
  WALL_COST,
  REINFORCED_WALL_COST,
  MINE_COST,
  DEFENDER_SETUP_RADIUS,
} from './Constants.js';

// ── Public entry ─────────────────────────────────────────────────

export function decideSetup(input) {
  const plan = { structures: [], startingTile: null };
  if (!input?.self) return plan;

  plan.startingTile = pickSpawnTile(input);
  if (input.self.side !== 'defender') return plan;

  plan.structures = planStructures(input);
  return plan;
}

// ── Spawn selection ──────────────────────────────────────────────

function pickSpawnTile(input) {
  const zone = input.map?.spawnZones?.[input.self.side] || [];
  if (zone.length === 0) return { q: 0, r: 0 };

  const taken = new Set(
    (input.teammates || [])
      .map((t) => (t.startingTile ? tileKey(t.startingTile.q, t.startingTile.r) : null))
      .filter(Boolean),
  );

  // Prefer a non-overlapping tile, but stacking is allowed if the cluster is
  // exhausted (small clusters + many players).
  const deterministicOrder = stableSort(zone, (a, b) => a.localeCompare(b));
  for (const key of deterministicOrder) {
    if (!taken.has(key)) {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    }
  }
  const [q, r] = deterministicOrder[0].split(',').map(Number);
  return { q, r };
}

// ── Defender structure planning ──────────────────────────────────

function planStructures(input) {
  const { self, map, teammates } = input;
  const profile = self.behaviorProfile || { aggression: 0.4, defense: 0.5 };

  // Pick the site this defender anchors — hash UUID to spread across sites.
  const siteIds = Object.keys(map.sites || {}).sort();
  if (siteIds.length === 0) return [];
  const mySiteId = siteIds[hashString(self.uuid) % siteIds.length];
  const mySite = map.sites[mySiteId];
  if (!mySite) return [];

  // Tiles already occupied by teammates' placements.
  const takenKeys = new Set();
  for (const tm of teammates || []) {
    for (const s of tm.structures || []) takenKeys.add(tileKey(s.at.q, s.at.r));
  }
  // Also exclude site tiles themselves.
  for (const s of Object.values(map.sites || {})) {
    takenKeys.add(tileKey(s.position.q, s.position.r));
  }
  // And attacker spawn tiles.
  for (const k of map.spawnZones?.attacker || []) takenKeys.add(k);

  // Candidate tiles: passable, in placement zone of my site, not taken.
  const candidates = [];
  for (let dr = -DEFENDER_SETUP_RADIUS; dr <= DEFENDER_SETUP_RADIUS; dr += 1) {
    for (let dq = -DEFENDER_SETUP_RADIUS; dq <= DEFENDER_SETUP_RADIUS; dq += 1) {
      const q = mySite.position.q + dq;
      const r = mySite.position.r + dr;
      if (!inBounds(q, r)) continue;
      const d = hexDist(mySite.position.q, mySite.position.r, q, r);
      if (d === 0 || d > DEFENDER_SETUP_RADIUS) continue;
      const key = tileKey(q, r);
      if (takenKeys.has(key)) continue;
      const tile = map.tiles[key];
      if (!tile || tile.type === 'mountain') continue;
      // Bias: tiles that are "approach corridors" — adjacent to at least 3
      // passable neighbors — are stronger chokepoints than isolated tiles.
      let passableNeighbors = 0;
      for (const nb of getNeighbors(q, r)) {
        if (!inBounds(nb.q, nb.r)) continue;
        const nt = map.tiles[tileKey(nb.q, nb.r)];
        if (nt && nt.type !== 'mountain') passableNeighbors += 1;
      }
      candidates.push({ q, r, distFromSite: d, passableNeighbors, key });
    }
  }

  // Sort: closer to site first, then high-connectivity (chokepoint quality).
  candidates.sort((a, b) => {
    if (a.distFromSite !== b.distFromSite) return a.distFromSite - b.distFromSite;
    return b.passableNeighbors - a.passableNeighbors;
  });

  // Budget allocation — profile-tuned.
  //   Aggressive (aggression > 0.6): 1 wall (on-site chokepoint) + 3 mines
  //   Defensive  (defense > 0.6):   1 reinforced wall + 1 wall + 1 mine
  //   Balanced:                      1 wall + 2 mines + 1 wall
  // All fit under DEFENDER_SETUP_BUDGET (100).
  const aggr = profile.aggression ?? 0.4;
  const def = profile.defense ?? 0.5;
  const mix =
    aggr > 0.6 ? 'aggressive'
    : def > 0.6 ? 'defensive'
    : 'balanced';

  const plan = [];
  let budget = self.budget || 0;

  const wantList = planByMix(mix);
  // For each desired (kind, zone) in the list, find the best candidate.
  const usedTiles = new Set();
  for (const want of wantList) {
    const cost = costOf(want.kind);
    if (cost > budget) continue;
    const pick = candidates.find((c) =>
      !usedTiles.has(c.key)
      && c.distFromSite >= want.minDist
      && c.distFromSite <= want.maxDist,
    );
    if (!pick) continue;
    plan.push({ kind: want.kind, at: { q: pick.q, r: pick.r } });
    usedTiles.add(pick.key);
    budget -= cost;
  }

  return plan;
}

function planByMix(mix) {
  // Each want: { kind, minDist, maxDist } — distance in hexes from the site.
  //   On-site chokepoint (dist 1): close-in blocker, forces defusers around.
  //   Approach (dist 2-4):         good for mines.
  //   Outer (dist 5-8):            fallback placement area.
  if (mix === 'aggressive') {
    return [
      { kind: 'wall', minDist: 1, maxDist: 1 },
      { kind: 'mine', minDist: 2, maxDist: 4 },
      { kind: 'mine', minDist: 2, maxDist: 5 },
      { kind: 'mine', minDist: 3, maxDist: 6 },
    ];
  }
  if (mix === 'defensive') {
    return [
      { kind: 'reinforced_wall', minDist: 1, maxDist: 1 },
      { kind: 'wall',            minDist: 1, maxDist: 2 },
      { kind: 'mine',            minDist: 3, maxDist: 5 },
    ];
  }
  // balanced
  return [
    { kind: 'wall', minDist: 1, maxDist: 1 },
    { kind: 'mine', minDist: 2, maxDist: 4 },
    { kind: 'wall', minDist: 2, maxDist: 3 },
    { kind: 'mine', minDist: 3, maxDist: 5 },
  ];
}

function costOf(kind) {
  switch (kind) {
    case 'wall': return WALL_COST;
    case 'reinforced_wall': return REINFORCED_WALL_COST;
    case 'mine': return MINE_COST;
    default: return Infinity;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function hashString(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function stableSort(arr, cmp) {
  return arr
    .map((v, i) => [v, i])
    .sort(([a, ai], [b, bi]) => {
      const c = cmp(a, b);
      return c !== 0 ? c : ai - bi;
    })
    .map(([v]) => v);
}

export default decideSetup;
