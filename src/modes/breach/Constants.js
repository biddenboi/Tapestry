/**
 * All numeric constants for breach mode live here.
 *
 * Every number in this file is a judgment call that will be tuned during
 * playtesting. No gameplay file anywhere else should hard-code these values —
 * import from here or take them as arguments.
 *
 * Values match spec §4.5.
 *
 * ──────────────────────────────────────────────────────────────────
 *  FAST_DEBUG MODE
 * ──────────────────────────────────────────────────────────────────
 * When `FAST_DEBUG` is true, match durations are compressed so a full
 * breach match (loading → H1 setup → H1 live → intermission → H2 setup
 * → H2 live → conclusion) completes in ~6–8 real-time minutes instead
 * of ~2 hours. Useful for verifying phase transitions, ELO wiring,
 * side-swap, and end-screen flow without grinding.
 *
 * Flip to `false` before shipping.
 */

import { MINUTE, SECOND } from '../../utils/Constants.js';

export const FAST_DEBUG = false;  // ← flip to true for compressed debug matches

// ── Match shape ───────────────────────────────────────────────────

export const HALF_DURATION_MS = FAST_DEBUG ? 3 * MINUTE : 60 * MINUTE;
export const MATCH_DURATION_MS = 2 * HALF_DURATION_MS;
// 90-second hard cap per the clarified spec: defenders have until their next
// task-session-start OR 90 seconds (whichever comes first) to act against a
// plant. `Bomb.js::transitionTick` treats this as an explosion trigger
// regardless of how many response windows are still open — it's the ceiling
// that guarantees a bomb always resolves in a bounded real-time window.
export const BOMB_TIMER_MS = 90 * SECOND;
export const SETUP_PHASE_CAP_MS = FAST_DEBUG ? 30 * SECOND : 3 * MINUTE;
export const INTERMISSION_MS = FAST_DEBUG ? 8 * SECOND : 30 * SECOND;

// ── Action costs ──────────────────────────────────────────────────

export const MOVE_COST_ATTACKER = 3;
export const MOVE_COST_DEFENDER = 2;
export const PLANT_COST = 30;
export const DEFUSE_COST = 30;
export const BREACH_WALL_COST = 40;
export const ATTACK_PLAYER_COST = 15;
export const RESPAWN_COST_ATTACKER = 60;
export const RESPAWN_COST_DEFENDER = 40;

// ── Defender setup economy (deferred — here for completeness) ─────

export const DEFENDER_SETUP_BUDGET = 100;
export const WALL_COST = 25;
export const REINFORCED_WALL_COST = 45;
export const MINE_COST = 20;
export const WALL_HP = 60;
export const REINFORCED_WALL_HP = 120;
export const MINE_DAMAGE = 60;

// ── Map constraints ───────────────────────────────────────────────

export const MIN_SITE_SPACING = 12;
export const MIN_SPAWN_SITE_DIST = 8;
export const MAX_SPAWN_SITE_DIST = 22;
export const MAX_ROTATION_DIST = 25;
export const DEFENDER_SETUP_RADIUS = 8;
export const ENEMY_VISIBILITY_RADIUS = 30;

// ── Combat ────────────────────────────────────────────────────────

export const PLAYER_MAX_HP = 100;
export const PLAYER_ATTACK_DAMAGE = 20;
export const PLANNER_MAX_ACTIONS_PER_TURN = 4;

// ── Phase ids ─────────────────────────────────────────────────────

export const PHASE = Object.freeze({
  loading: 'loading',
  setup_h1: 'setup_h1',
  live_h1: 'live_h1',
  intermission: 'intermission',
  setup_h2: 'setup_h2',
  live_h2: 'live_h2',
  conclusion: 'conclusion',
});

export const LIVE_PHASES = new Set([PHASE.live_h1, PHASE.live_h2]);

// ── Side ids ──────────────────────────────────────────────────────

export const SIDE = Object.freeze({ attacker: 'attacker', defender: 'defender' });

// ── Derived cost accessor ─────────────────────────────────────────

/**
 * Resolve the cost table for a given side. Returned object is consumed by
 * planner input and by rule validation.
 */
export function costsForSide(side) {
  const isAttacker = side === SIDE.attacker;
  return {
    move: isAttacker ? MOVE_COST_ATTACKER : MOVE_COST_DEFENDER,
    plant: isAttacker ? PLANT_COST : Infinity,
    defuse: isAttacker ? Infinity : DEFUSE_COST,
    breach: isAttacker ? BREACH_WALL_COST : Infinity,
    attackPlayer: ATTACK_PLAYER_COST,
    respawn: isAttacker ? RESPAWN_COST_ATTACKER : RESPAWN_COST_DEFENDER,
  };
}