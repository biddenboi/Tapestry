/**
 * Observation encoder for the breach Neural Team Planner.
 *
 * Converts the team-planner input (the same shape `resolveTick` passes to
 * `teamPlanner`) into a fixed-length Float32Array that the policy net
 * consumes. Same function runs at training time (inside the headless match
 * simulator) and at game time (inside the browser arena), so there is no
 * train/deploy gap — the feature semantics are identical by construction.
 *
 * ── Design principles ─────────────────────────────────────────────
 *
 * Every feature is one of:
 *   - normalized to [-1, 1] or [0, 1]
 *   - a binary 0/1 flag
 *   - a clamped relative offset (e.g. dq, dr divided by map extent)
 *
 * Nothing is left raw (no un-normalized pixel coords, no un-bounded hp counts).
 * ReLU MLPs are sensitive to input scale; mis-scaled features swamp the net.
 *
 * Order and count are FROZEN once training starts — if you add, remove, or
 * reorder a feature you invalidate every weights file trained against the
 * old layout. Bump the `format` in Network.js when you do.
 *
 * ── Layout ────────────────────────────────────────────────────────
 *
 *   SELF_START            0..SELF_DIM                          (13 floats)
 *   SITE_START            SITE_DIM * 3                         (36 floats)
 *   TEAMMATE_START        TEAMMATE_DIM * MAX_TEAMMATES         (16 floats)
 *   ENEMY_START           ENEMY_DIM * MAX_ENEMIES              (21 floats)
 *   NEIGHBOR_START        NEIGHBOR_DIM * 6                     (18 floats)
 *   CLOCK_START           CLOCK_DIM                            (4 floats)
 *   SCORE_START           SCORE_DIM                            (4 floats)
 *                                                     TOTAL =  112 floats
 */

import { hexDist, tileKey, getNeighbors } from '../../../engine/hex.js';
import { MAP_COLS, MAP_ROWS } from '../../../engine/hex.js';
import { SIDE, PLAYER_MAX_HP } from '../Constants.js';

// ── Observation dimensions (frozen) ───────────────────────────────

const SELF_DIM     = 13;
const SITE_DIM     = 12;
const TEAMMATE_DIM = 8;
const ENEMY_DIM    = 7;
const NEIGHBOR_DIM = 3;
const CLOCK_DIM    = 4;
const SCORE_DIM    = 4;

const MAX_TEAMMATES = 2;   // 3v3 — each policy has at most 2 teammates besides self
const MAX_ENEMIES   = 3;   // we show the 3 closest visible enemies, padded

export const OBS_DIM =
  SELF_DIM +
  SITE_DIM * 3 +
  TEAMMATE_DIM * MAX_TEAMMATES +
  ENEMY_DIM * MAX_ENEMIES +
  NEIGHBOR_DIM * 6 +
  CLOCK_DIM +
  SCORE_DIM;

// ── Normalization constants ───────────────────────────────────────

const MAX_HEX_DIST = Math.sqrt(MAP_COLS * MAP_COLS + MAP_ROWS * MAP_ROWS);
const HALF_MS_HINT = 60 * 60 * 1000;     // matches HALF_DURATION_MS in live mode
const BOMB_MS_HINT = 90 * 1000;          // matches BOMB_TIMER_MS
const FINAL_PUSH_HINT_MS = 5 * 60 * 1000;
const MAX_POINTS_HINT = 600;             // points rarely reach this — serves as a soft cap

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clampSigned(x) { return x < -1 ? -1 : x > 1 ? 1 : x; }

// ── Canonical hex direction order ─────────────────────────────────
//
// ActionDecoder reads direction outputs against this exact order, so any
// rotation here must be matched there. Mirrors the neighbor order used by
// engine/hex.getNeighbors for the two-row parity cases.

const NEIGHBOR_ORDER_EVEN_ROW = [
  { q:  1, r:  0 }, { q:  0, r: -1 }, { q: -1, r: -1 },
  { q: -1, r:  0 }, { q: -1, r:  1 }, { q:  0, r:  1 },
];
const NEIGHBOR_ORDER_ODD_ROW = [
  { q:  1, r:  0 }, { q:  1, r: -1 }, { q:  0, r: -1 },
  { q: -1, r:  0 }, { q:  0, r:  1 }, { q:  1, r:  1 },
];
export function neighborsInOrder(q, r) {
  const base = (r & 1) ? NEIGHBOR_ORDER_ODD_ROW : NEIGHBOR_ORDER_EVEN_ROW;
  return base.map(({ q: dq, r: dr }) => ({ q: q + dq, r: r + dr }));
}

// ── Main encoder ──────────────────────────────────────────────────

/**
 * Build an observation vector for one acting ghost.
 *
 * `snap` is the snapshot structure described at the top of this file — an
 * object with byUUID, enemies, map, costs, clock. `actorUUID` picks out the
 * ghost whose egocentric observation we want.
 *
 * Returns a Float32Array of length OBS_DIM.
 */
export function encodeObservation(actorUUID, snap) {
  const obs = new Float32Array(OBS_DIM);
  const self = snap.byUUID[actorUUID];
  if (!self) return obs;   // unknown actor — all zeros, policy will output something-ish

  const isAttacker = self.side === SIDE.attacker;
  const sites = snap.map?.sites || {};
  const siteIds = ['A', 'B', 'C'];

  let o = 0;

  // ── Self ────────────────────────────────────────────────────────
  obs[o + 0]  = clamp01((self.hp ?? PLAYER_MAX_HP) / PLAYER_MAX_HP);
  obs[o + 1]  = clamp01((self.points || 0) / MAX_POINTS_HINT);
  obs[o + 2]  = self.alive ? 1 : 0;
  obs[o + 3]  = isAttacker ? 1 : 0;
  obs[o + 4]  = clampSigned((self.position.q / MAP_COLS) * 2 - 1);
  obs[o + 5]  = clampSigned((self.position.r / MAP_ROWS) * 2 - 1);

  // can_plant_here / can_defuse_here / on_site flags
  const onSite   = siteIds.find((id) => {
    const s = sites[id];
    return s && s.position.q === self.position.q && s.position.r === self.position.r;
  });
  const adjSite  = siteIds.find((id) => {
    const s = sites[id];
    return s && hexDist(self.position.q, self.position.r, s.position.q, s.position.r) <= 1;
  });
  const canPlant  = isAttacker && onSite && sites[onSite]?.state === 'idle'
                                        && (self.points || 0) >= (snap.costs?.plant || Infinity);
  const armedAdj  = adjSite && sites[adjSite]?.state === 'armed';
  const canDefuse = !isAttacker && armedAdj
                    && (snap.armedBombs?.[adjSite]?.defenderResponseAvailable?.[actorUUID])
                    && (self.points || 0) >= (snap.costs?.defuse || Infinity);
  obs[o + 6]  = canPlant ? 1 : 0;
  obs[o + 7]  = canDefuse ? 1 : 0;
  obs[o + 8]  = (onSite && sites[onSite]?.state === 'idle') ? 1 : 0;
  obs[o + 9]  = (onSite && sites[onSite]?.state === 'armed') ? 1 : 0;
  obs[o + 10] = (adjSite && sites[adjSite]?.state === 'idle') ? 1 : 0;
  obs[o + 11] = (adjSite && sites[adjSite]?.state === 'armed') ? 1 : 0;

  // num_adjacent_enemies
  let adjEnemies = 0;
  for (const e of snap.enemies || []) {
    if (!e.alive) continue;
    if (hexDist(self.position.q, self.position.r, e.position.q, e.position.r) === 1) adjEnemies += 1;
  }
  obs[o + 12] = clamp01(adjEnemies / 3);
  o += SELF_DIM;

  // ── Sites (A, B, C in fixed order) ──────────────────────────────
  // Find nearest idle site to me first so we can tag it — the policy uses
  // that flag a lot during training ("is this the one I should push?").
  let nearestIdleSite = null;
  let nearestIdleDist = Infinity;
  for (const id of siteIds) {
    const s = sites[id];
    if (!s || s.state !== 'idle') continue;
    const d = hexDist(self.position.q, self.position.r, s.position.q, s.position.r);
    if (d < nearestIdleDist) { nearestIdleDist = d; nearestIdleSite = id; }
  }

  for (const id of siteIds) {
    const s = sites[id];
    if (!s) { o += SITE_DIM; continue; }
    obs[o + 0] = s.state === 'idle'     ? 1 : 0;
    obs[o + 1] = s.state === 'armed'    ? 1 : 0;
    obs[o + 2] = s.state === 'defused'  ? 1 : 0;
    obs[o + 3] = s.state === 'exploded' ? 1 : 0;
    const d = hexDist(self.position.q, self.position.r, s.position.q, s.position.r);
    obs[o + 4] = clamp01(d / MAX_HEX_DIST);
    let nearestEnemyDist = MAX_HEX_DIST;
    for (const e of snap.enemies || []) {
      if (!e.alive) continue;
      const de = hexDist(e.position.q, e.position.r, s.position.q, s.position.r);
      if (de < nearestEnemyDist) nearestEnemyDist = de;
    }
    obs[o + 5] = clamp01(nearestEnemyDist / MAX_HEX_DIST);
    const armed = snap.armedBombs?.[id] || null;
    if (armed) {
      const left = Math.max(0, armed.expiresAtMatchMs - (snap.clock?.matchMs || 0));
      obs[o + 6] = clamp01(left / BOMB_MS_HINT);
      obs[o + 7] = armed.defenderResponseAvailable?.[actorUUID] ? 1 : 0;
    } else {
      obs[o + 6] = 0;
      obs[o + 7] = 0;
    }
    obs[o + 8] = clampSigned((s.position.q - self.position.q) / MAP_COLS);
    obs[o + 9] = clampSigned((s.position.r - self.position.r) / MAP_ROWS);
    // controlled_by_us — idle site is contested, defused = defenders, exploded = attackers
    obs[o + 10] = (s.state === 'defused' && !isAttacker) ? 1
                : (s.state === 'exploded' && isAttacker) ? 1
                : 0;
    obs[o + 11] = (id === nearestIdleSite) ? 1 : 0;
    o += SITE_DIM;
  }

  // ── Teammates (up to MAX_TEAMMATES, padded) ─────────────────────
  const teammates = Object.values(snap.byUUID).filter((m) => m.uuid !== actorUUID);
  // Sort by distance so the closest teammate always goes into slot 0 — gives
  // the net a consistent "who's near me" signal instead of UUID-order noise.
  teammates.sort((a, b) => {
    const da = hexDist(self.position.q, self.position.r, a.position.q, a.position.r);
    const db = hexDist(self.position.q, self.position.r, b.position.q, b.position.r);
    return da - db;
  });
  for (let t = 0; t < MAX_TEAMMATES; t += 1) {
    const m = teammates[t];
    if (!m) { o += TEAMMATE_DIM; continue; }
    obs[o + 0] = m.alive ? 1 : 0;
    obs[o + 1] = clamp01((m.hp ?? PLAYER_MAX_HP) / PLAYER_MAX_HP);
    obs[o + 2] = clamp01((m.points || 0) / MAX_POINTS_HINT);
    obs[o + 3] = clampSigned((m.position.q - self.position.q) / MAP_COLS);
    obs[o + 4] = clampSigned((m.position.r - self.position.r) / MAP_ROWS);
    const md = hexDist(self.position.q, self.position.r, m.position.q, m.position.r);
    obs[o + 5] = clamp01(md / MAX_HEX_DIST);
    obs[o + 6] = siteIds.some((id) => {
      const s = sites[id];
      return s && s.position.q === m.position.q && s.position.r === m.position.r;
    }) ? 1 : 0;
    // is_closer_to_nearest_idle_site_than_me — rough "should I be the planter?"
    let teammateIdleDist = Infinity;
    if (nearestIdleSite) {
      const s = sites[nearestIdleSite];
      teammateIdleDist = hexDist(m.position.q, m.position.r, s.position.q, s.position.r);
    }
    obs[o + 7] = (teammateIdleDist < nearestIdleDist) ? 1 : 0;
    o += TEAMMATE_DIM;
  }

  // ── Enemies (up to MAX_ENEMIES, closest-first, padded) ──────────
  const enemies = (snap.enemies || []).slice().filter((e) => e.alive);
  enemies.sort((a, b) => {
    const da = hexDist(self.position.q, self.position.r, a.position.q, a.position.r);
    const db = hexDist(self.position.q, self.position.r, b.position.q, b.position.r);
    return da - db;
  });
  for (let i = 0; i < MAX_ENEMIES; i += 1) {
    const e = enemies[i];
    if (!e) { o += ENEMY_DIM; continue; }
    obs[o + 0] = 1;
    obs[o + 1] = clamp01((e.hp ?? PLAYER_MAX_HP) / PLAYER_MAX_HP);
    obs[o + 2] = clampSigned((e.position.q - self.position.q) / MAP_COLS);
    obs[o + 3] = clampSigned((e.position.r - self.position.r) / MAP_ROWS);
    const ed = hexDist(self.position.q, self.position.r, e.position.q, e.position.r);
    obs[o + 4] = clamp01(ed / MAX_HEX_DIST);
    obs[o + 5] = siteIds.some((id) => {
      const s = sites[id];
      return s && s.position.q === e.position.q && s.position.r === e.position.r;
    }) ? 1 : 0;
    obs[o + 6] = ed === 1 ? 1 : 0;
    o += ENEMY_DIM;
  }

  // ── 6 neighborhood tiles (in canonical hex-direction order) ─────
  const structures = snap.map?.structures || {};
  const tiles = snap.map?.tiles || {};
  const neighbors = neighborsInOrder(self.position.q, self.position.r);
  for (const nb of neighbors) {
    const k = tileKey(nb.q, nb.r);
    const tile = tiles[k];
    const struct = structures[k];
    const inBoundsFlag = tile && tile.type !== 'mountain';
    let passable = 0;
    let hasMine = 0;
    let hasWall = 0;
    if (inBoundsFlag) {
      passable = 1;
      if (struct) {
        if (struct.kind === 'mine') hasMine = 1;
        if ((struct.kind === 'wall' || struct.kind === 'reinforced_wall') && struct.hp > 0) {
          passable = 0;
          hasWall = 1;
        }
      }
    }
    obs[o + 0] = passable;
    obs[o + 1] = hasMine;
    obs[o + 2] = hasWall;
    o += NEIGHBOR_DIM;
  }

  // ── Clock ───────────────────────────────────────────────────────
  const clock = snap.clock || {};
  const timeInHalf = clock.matchMs - (clock.halfStartMs || 0);
  const halfDuration = Math.max(1, (clock.halfEndMs || HALF_MS_HINT) - (clock.halfStartMs || 0));
  const timeLeft = Math.max(0, (clock.halfEndMs || HALF_MS_HINT) - (clock.matchMs || 0));
  obs[o + 0] = clamp01(timeInHalf / halfDuration);
  obs[o + 1] = clamp01(timeLeft / HALF_MS_HINT);
  obs[o + 2] = timeLeft <= FINAL_PUSH_HINT_MS ? 1 : 0;
  obs[o + 3] = (clock.halfNumber || 1) === 2 ? 1 : 0;
  o += CLOCK_DIM;

  // ── Score ───────────────────────────────────────────────────────
  // snap.score is a bookkeeping field we attach in NeuralTeamPlanner /
  // training env — it's not part of the input `resolveTick` currently
  // passes to `teamPlanner`, so we synthesize it from site states as a
  // fallback.
  let mySitesWon = 0, enemySitesWon = 0, sitesResolved = 0, sitesIdle = 0;
  for (const id of siteIds) {
    const s = sites[id];
    if (!s) continue;
    if (s.state === 'idle')          sitesIdle      += 1;
    else                             sitesResolved  += 1;
    // Each site-round counts once; we don't see half-number detail without
    // siteOutcomes, so this is an approximation of "score so far".
    if (s.state === 'defused'  && !isAttacker) mySitesWon    += 1;
    if (s.state === 'exploded' &&  isAttacker) mySitesWon    += 1;
    if (s.state === 'defused'  &&  isAttacker) enemySitesWon += 1;
    if (s.state === 'exploded' && !isAttacker) enemySitesWon += 1;
  }
  obs[o + 0] = clamp01(mySitesWon / 3);
  obs[o + 1] = clamp01(enemySitesWon / 3);
  obs[o + 2] = clamp01(sitesResolved / 3);
  obs[o + 3] = clamp01(sitesIdle / 3);

  return obs;
}
