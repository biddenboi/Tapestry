/**
 * Neural Team Planner — the only breach team AI in this build.
 *
 * Contract (same signature the engine expects on any team planner):
 *
 *   decideTeamTurnNN(teamInput) => { [ghostUUID]: Action[] }
 *
 * so `Turn.js::resolveTick` routes through this exactly as it would any
 * team planner: same input shape, same output shape, same invariants (one
 * plan per acting ghost, actions that pass `rules.js` validation, no
 * pooling of points across ghosts).
 *
 * ── How it works at a glance ──────────────────────────────────────
 *
 * For each acting ghost (iterated in the same deterministic UUID-sort order
 * the rule-based planner used):
 *
 *   1. Encode a fixed-size observation from the team snapshot (same
 *      encoder the trainer uses — there is NO training/deploy gap).
 *   2. Build a legality mask over the three output heads. Everything the
 *      rules would reject is masked to -Infinity.
 *   3. Run one forward pass through the policy net.
 *   4. Argmax the masked logits → concrete Action.
 *   5. Apply the action speculatively to a local snapshot so the next
 *      teammate planning this tick doesn't collide with our chosen move.
 *
 * ── Per-ghost budgets ─────────────────────────────────────────────
 *
 * The spec is explicit: each ghost's point budget is private. The net
 * sees all teammates' budgets as features (so a "wealthy teammate should
 * plant" signal can emerge) but it never spends from them. Action legality
 * masks are computed against the individual ghost's current points in the
 * snapshot, so an action the net wants to take can only be chosen if the
 * acting ghost can actually afford it.
 *
 * ── Failure handling ──────────────────────────────────────────────
 *
 * If the weights file is missing, malformed, or fails to build a net, the
 * factory returns a planner that emits passes for every ghost. The arena
 * keeps running; the match is boring but correct. Loud console.warn so
 * the developer notices.
 */

import { buildNet, maskedArgmax } from './neural/Network.js';
import { encodeObservation } from './neural/Observation.js';
import { buildMask, decodeAction } from './neural/ActionDecoder.js';
import { SIDE } from './Constants.js';

// ── Public factory ────────────────────────────────────────────────

/**
 * Build a team planner backed by a loaded weights object. Pass the parsed
 * JSON (or a JS object) from `weights.default.json` or any other file that
 * matches the breach-policy-v1 schema.
 *
 * If you want per-match stochasticity (e.g. an optional temperature-based
 * sample for variety), pass `sampler: (logits, mask) => idx`. Defaults to
 * deterministic argmax so identical match replays produce identical plans.
 */
export function createNeuralTeamPlanner(spec, options = {}) {
  let net = null;
  try {
    net = buildNet(spec);
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[NeuralTeamPlanner] failed to load weights:', err.message,
        '— falling back to pass-everywhere planner');
    }
    return passEverywhere;
  }

  const sampler = options.sampler || maskedArgmax;

  return function decideTeamTurnNN(input) {
    if (!input?.actingGhosts?.length) return {};
    // Same snapshot the rule-based planner cloned — lets us mutate position/
    // points/enemy-hp locally so the next teammate sees the effect of an
    // earlier teammate's plan.
    const snap = cloneSnapshot(input);
    const plans = {};

    const acting = input.actingGhosts.slice()
      .sort((a, b) => a.uuid.localeCompare(b.uuid));

    for (const { uuid } of acting) {
      const self = snap.byUUID[uuid];
      if (!self) { plans[uuid] = [{ kind: 'pass' }]; continue; }

      let action;
      try {
        const obs = encodeObservation(uuid, snap);
        const mask = buildMask(uuid, snap);
        const logits = net.forward(obs);
        action = decodeAction(logits, mask, uuid, snap, sampler);
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[NeuralTeamPlanner] inference failed for', uuid, err.message);
        }
        action = { kind: 'pass' };
      }

      plans[uuid] = [action];
      applySpeculative(snap, uuid, action);
    }
    return plans;
  };
}

function passEverywhere(input) {
  const plans = {};
  for (const g of input?.actingGhosts || []) plans[g.uuid] = [{ kind: 'pass' }];
  return plans;
}

// ── Snapshot helpers ──────────────────────────────────────────────
//
// Per-tick local working copy — mutation-free from the caller's perspective
// (we never write into the input), but the copy is mutated across
// teammates within a tick so ghost B plans against ghost A's speculative
// move, not the pre-tick state.

function cloneSnapshot(input) {
  const byUUID = {};
  for (const m of input.members || []) {
    byUUID[m.uuid] = {
      uuid: m.uuid,
      side: input.side,
      position: { q: m.position.q, r: m.position.r },
      points: m.points,
      alive: m.alive,
      hp: m.hp,
      responseWindowFor: [...(m.responseWindowFor || [])],
    };
  }
  const enemies = (input.enemies || []).map((e) => ({
    uuid: e.uuid,
    position: { q: e.position.q, r: e.position.r },
    hp: e.hp,
    alive: e.alive,
  }));
  return {
    byUUID,
    enemies,
    map: {
      tiles: input.map.tiles,
      sites: input.map.sites,
      structures: { ...(input.map.structures || {}) },
    },
    armedBombs: input.armedBombs || {},
    costs: input.costs,
    clock: input.clock,
  };
}

function applySpeculative(snap, uuid, action) {
  const m = snap.byUUID[uuid];
  if (!m) return;
  const costs = snap.costs || {};
  switch (action?.kind) {
    case 'move':
      m.position = { ...action.to };
      m.points -= costs.move || 0;
      break;
    case 'sprint': {
      const last = action.path[action.path.length - 1];
      m.position = { ...last };
      m.points -= (costs.move || 0) * action.path.length;
      break;
    }
    case 'attack': {
      m.points -= costs.attackPlayer || 0;
      const enemy = snap.enemies.find((e) => e.uuid === action.targetUUID);
      if (enemy) enemy.hp = Math.max(0, enemy.hp - 20);
      break;
    }
    case 'plant':
      m.points -= costs.plant || 0;
      break;
    case 'defuse':
      m.points -= costs.defuse || 0;
      break;
    case 'respawn':
      m.points -= costs.respawn || 0;
      m.alive = true;
      m.hp = 100;
      break;
    default: break;
  }
}

// ── Default-planner convenience ───────────────────────────────────

/**
 * Convenience: build the planner from the shipped default weights file.
 * Callers that want a specific weights file (a custom training artifact,
 * say) should skip this and call createNeuralTeamPlanner(spec) directly.
 *
 * Import paths for the default weights are passed in by the caller so this
 * module stays environment-neutral (works under Webpack/Vite in the browser
 * and under Node in the trainer without an import-assertion dance).
 */
export function createDefaultPlanner(defaultWeightsSpec, options) {
  return createNeuralTeamPlanner(defaultWeightsSpec, options);
}

export default createNeuralTeamPlanner;
