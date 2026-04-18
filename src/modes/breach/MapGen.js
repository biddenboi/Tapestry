/**
 * Breach map generator.
 *
 * Three-stage pipeline (spec §3.2):
 *   1. Template selection — pick one of the hand-authored templates by seed.
 *   2. Stamping — apply mountain stamps, then carve corridors (corridors win).
 *   3. Site selection — constrained random sampling over candidate anchors.
 *
 * Output: a full tile map (same shape as conquest's tiles, minus the
 * conquest-specific `owner`/`hp` fields), a chosen site triple keyed A/B/C,
 * and the two spawn zones. No walls/mines here — that's setup phase.
 *
 * All hex math comes from engine/hex. Mountain tiles are always impassable
 * and non-plantable. Corridor tiles are always passable.
 */

import {
  tileKey,
  hexDist,
  getNeighbors,
  inBounds,
  MAP_COLS,
  MAP_ROWS,
  seededRNG,
} from '../../engine/hex.js';
import {
  MIN_SITE_SPACING,
  MIN_SPAWN_SITE_DIST,
  MAX_SPAWN_SITE_DIST,
  MAX_ROTATION_DIST,
} from './Constants.js';
import { TEMPLATES } from './templates.js';

// ── Stage 1 — Template selection ──────────────────────────────────

function pickTemplate(rng) {
  return TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
}

// ── Stage 2 — Stamping ────────────────────────────────────────────

function buildTileGrid() {
  // Start with an all-grass grid. Mountains and corridors override.
  const tiles = {};
  for (let r = 0; r < MAP_ROWS; r += 1) {
    for (let q = 0; q < MAP_COLS; q += 1) {
      tiles[tileKey(q, r)] = {
        q,
        r,
        type: 'grass',
      };
    }
  }
  return tiles;
}

function applyMountainStamps(tiles, stamps, rng) {
  for (const stamp of stamps) {
    if (stamp.kind === 'rect') {
      for (let r = stamp.r0; r <= stamp.r1; r += 1) {
        for (let q = stamp.q0; q <= stamp.q1; q += 1) {
          if (!inBounds(q, r)) continue;
          tiles[tileKey(q, r)] = { q, r, type: 'mountain' };
        }
      }
    } else if (stamp.kind === 'blob') {
      const rad = stamp.radius;
      for (let r = stamp.r - rad; r <= stamp.r + rad; r += 1) {
        for (let q = stamp.q - rad; q <= stamp.q + rad; q += 1) {
          if (!inBounds(q, r)) continue;
          if (hexDist(stamp.q, stamp.r, q, r) <= rad) {
            tiles[tileKey(q, r)] = { q, r, type: 'mountain' };
          }
        }
      }
    }
  }
  // Light noise: add a small amount of scattered mountains in the empty zones
  // so maps don't feel sterile, keeping the template's corridors intact (the
  // carve pass below re-opens them).
  for (let r = 0; r < MAP_ROWS; r += 1) {
    for (let q = 12; q < MAP_COLS - 12; q += 1) {
      if (tiles[tileKey(q, r)].type === 'grass' && rng() < 0.05) {
        tiles[tileKey(q, r)] = { q, r, type: 'mountain' };
      }
    }
  }
}

function carveCorridors(tiles, skeleton) {
  for (const { path } of skeleton) {
    for (const { q, r } of path) {
      if (!inBounds(q, r)) continue;
      tiles[tileKey(q, r)] = { q, r, type: 'grass' };
    }
  }
}

function carveSpawnZones(tiles, zones) {
  for (const side of ['attacker', 'defender']) {
    for (const { q, r } of zones[side] || []) {
      if (!inBounds(q, r)) continue;
      tiles[tileKey(q, r)] = { q, r, type: 'grass' };
    }
  }
}

// ── Stage 3 — Constrained site selection ──────────────────────────

function bfsDistance(tiles, from, isBlocked) {
  // Multi-source BFS from `from` through passable tiles. Returns a
  // `Map<tileKey, distance>` for every reachable tile.
  const seen = new Map();
  const queue = [];
  const startKey = tileKey(from.q, from.r);
  seen.set(startKey, 0);
  queue.push({ q: from.q, r: from.r, d: 0 });
  while (queue.length) {
    const { q, r, d } = queue.shift();
    for (const nb of getNeighbors(q, r)) {
      if (!inBounds(nb.q, nb.r)) continue;
      const key = tileKey(nb.q, nb.r);
      if (seen.has(key)) continue;
      const tile = tiles[key];
      if (isBlocked(tile)) continue;
      seen.set(key, d + 1);
      queue.push({ q: nb.q, r: nb.r, d: d + 1 });
    }
  }
  return seen;
}

function siteHasTwoEntrances(tiles, site) {
  // A site must be reachable from outside its radius-3 bubble through at
  // least two distinct neighboring tiles of the bubble's boundary. We
  // approximate by counting how many immediate neighbors of the site's
  // radius-3 perimeter are passable.
  const passable = (t) => t && t.type !== 'mountain';
  if (!passable(tiles[tileKey(site.q, site.r)])) return false;

  // Collect all tiles within radius 3, then count neighbors of boundary
  // tiles that are passable and outside the bubble.
  const bubble = new Set();
  for (let r = site.r - 3; r <= site.r + 3; r += 1) {
    for (let q = site.q - 3; q <= site.q + 3; q += 1) {
      if (!inBounds(q, r)) continue;
      if (hexDist(site.q, site.r, q, r) <= 3) bubble.add(tileKey(q, r));
    }
  }
  let distinctEntrances = 0;
  const counted = new Set();
  for (const key of bubble) {
    const [bq, br] = key.split(',').map(Number);
    for (const nb of getNeighbors(bq, br)) {
      const nbKey = tileKey(nb.q, nb.r);
      if (bubble.has(nbKey)) continue;
      if (!inBounds(nb.q, nb.r)) continue;
      if (!passable(tiles[nbKey])) continue;
      if (counted.has(nbKey)) continue;
      counted.add(nbKey);
      distinctEntrances += 1;
      if (distinctEntrances >= 2) return true;
    }
  }
  return distinctEntrances >= 2;
}

/**
 * Try every combination of 3 anchors and return the first triple that
 * satisfies all spec §3.2 constraints. Shuffled so different seeds pick
 * different triples. Returns null if no valid triple exists.
 */
function pickSiteTriple(tiles, anchors, spawnZones, rng) {
  // Center points of each spawn zone — use the mean tile coordinate.
  const center = (zone) => {
    if (!zone?.length) return { q: 0, r: 0 };
    const q = zone.reduce((s, t) => s + t.q, 0) / zone.length;
    const r = zone.reduce((s, t) => s + t.r, 0) / zone.length;
    return { q, r };
  };
  const atkCenter = center(spawnZones.attacker);
  const defCenter = center(spawnZones.defender);

  const passable = (t) => t && t.type !== 'mountain';
  const isBlocked = (t) => !passable(t);

  // Shuffle a working copy of anchors for varied triples across seeds.
  const pool = [...anchors];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Pre-validate each anchor's entrance count so the triple loop is cheap.
  const viableAnchors = pool.filter((a) => siteHasTwoEntrances(tiles, a));
  if (viableAnchors.length < 3) return null;

  // Precompute BFS distance grids from each viable anchor, used for the
  // rotation constraint between sites.
  const anchorDists = new Map();
  for (const a of viableAnchors) {
    anchorDists.set(tileKey(a.q, a.r), bfsDistance(tiles, a, isBlocked));
  }

  // Helper: pairwise hex distance ≥ MIN_SITE_SPACING.
  const spacingOk = (a, b) => hexDist(a.q, a.r, b.q, b.r) >= MIN_SITE_SPACING;

  // Helper: rotation distance ≤ MAX_ROTATION_DIST.
  const rotationOk = (a, b) => {
    const from = anchorDists.get(tileKey(a.q, a.r));
    const d = from?.get(tileKey(b.q, b.r));
    return Number.isFinite(d) && d <= MAX_ROTATION_DIST;
  };

  // Helper: each site's distance from attacker/defender spawns within bounds.
  const spawnOk = (a) => {
    const dAtk = hexDist(Math.round(atkCenter.q), Math.round(atkCenter.r), a.q, a.r);
    const dDef = hexDist(Math.round(defCenter.q), Math.round(defCenter.r), a.q, a.r);
    return dAtk >= MIN_SPAWN_SITE_DIST
      && dAtk <= MAX_SPAWN_SITE_DIST
      && dDef >= MIN_SPAWN_SITE_DIST;
  };

  const filtered = viableAnchors.filter(spawnOk);
  if (filtered.length < 3) return null;

  for (let i = 0; i < filtered.length - 2; i += 1) {
    for (let j = i + 1; j < filtered.length - 1; j += 1) {
      for (let k = j + 1; k < filtered.length; k += 1) {
        const a = filtered[i], b = filtered[j], c = filtered[k];
        if (!spacingOk(a, b) || !spacingOk(a, c) || !spacingOk(b, c)) continue;
        if (!rotationOk(a, b) || !rotationOk(a, c) || !rotationOk(b, c)) continue;
        return [a, b, c];
      }
    }
  }
  return null;
}

/**
 * Guarantee attacker spawn can reach every site tile. If noise has broken
 * connectivity, carve a minimum path through mountains to fix it.
 */
function ensureSpawnToSiteReachability(tiles, spawnZones, sites) {
  const isBlocked = (t) => !t || t.type === 'mountain';
  for (const spawn of spawnZones.attacker) {
    const dists = bfsDistance(tiles, spawn, isBlocked);
    for (const site of sites) {
      if (dists.has(tileKey(site.q, site.r))) continue;
      carveMinimumPath(tiles, spawn, site);
    }
  }
}

function carveMinimumPath(tiles, from, to) {
  // BFS ignoring mountains; on finding `to`, flip every tile along the path
  // to grass. Same pattern as conquest's ensurePercolation.
  const seen = new Map();
  seen.set(tileKey(from.q, from.r), null);
  const queue = [{ q: from.q, r: from.r }];
  while (queue.length) {
    const { q, r } = queue.shift();
    if (q === to.q && r === to.r) {
      // Walk back through parents, carving.
      let cur = tileKey(q, r);
      while (cur) {
        const [cq, cr] = cur.split(',').map(Number);
        tiles[cur] = { q: cq, r: cr, type: 'grass' };
        cur = seen.get(cur);
      }
      return;
    }
    for (const nb of getNeighbors(q, r)) {
      if (!inBounds(nb.q, nb.r)) continue;
      const key = tileKey(nb.q, nb.r);
      if (seen.has(key)) continue;
      seen.set(key, tileKey(q, r));
      queue.push(nb);
    }
  }
}

// ── Public entry ──────────────────────────────────────────────────

/**
 * Generate a full breach map from a seed.
 * Returns:
 *   {
 *     templateId, templateLabel,
 *     tiles: Record<tileKey, Tile>,
 *     sites: { A: SiteState, B: SiteState, C: SiteState },
 *     spawnZones: { attacker: string[], defender: string[] },   // tile keys
 *   }
 *
 * On failure to satisfy site constraints (would only happen if templates are
 * misauthored), falls back to the first template's candidate anchors in order.
 */
export function generateBreachMap(seed) {
  const rng = seededRNG(seed);
  const template = pickTemplate(rng);

  const tiles = buildTileGrid();
  applyMountainStamps(tiles, template.mountainStamps, rng);
  carveCorridors(tiles, template.corridorSkeleton);
  carveSpawnZones(tiles, template.spawnZones);

  let triple = pickSiteTriple(tiles, template.candidateSiteAnchors, template.spawnZones, rng);
  if (!triple) {
    // Fallback: take first three candidate anchors in declaration order,
    // ignoring constraints. Templates should be pre-validated offline.
    // eslint-disable-next-line no-console
    console.warn(`[breach/MapGen] Constraint solver found no valid triple for template "${template.id}"; using ordered fallback.`);
    triple = template.candidateSiteAnchors.slice(0, 3);
  }

  const sites = {
    A: { id: 'A', position: triple[0], state: 'idle' },
    B: { id: 'B', position: triple[1], state: 'idle' },
    C: { id: 'C', position: triple[2], state: 'idle' },
  };

  ensureSpawnToSiteReachability(tiles, template.spawnZones, triple);

  const spawnZones = {
    attacker: template.spawnZones.attacker.map((t) => tileKey(t.q, t.r)),
    defender: template.spawnZones.defender.map((t) => tileKey(t.q, t.r)),
  };

  return {
    templateId: template.id,
    templateLabel: template.label,
    tiles,
    sites,
    spawnZones,
  };
}
