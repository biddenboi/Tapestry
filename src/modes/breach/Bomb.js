/**
 * Bomb state machine.
 *
 * One state machine per site. States per spec §3.4:
 *   IDLE     — no bomb activity
 *   ARMED    — bomb planted, timer running
 *   DEFUSED  — terminal, defence wins the site-round
 *   EXPLODED — terminal, attack wins the site-round
 *
 * Pure — no I/O, no React, no match-state mutation. Every call takes the
 * current state, an event, and returns the next state plus effect records.
 * Callers (Turn.js) apply the state changes to the match record and dispatch
 * effects to the arena (point spend, site-outcome accrual, etc.).
 *
 * State-machine-level guards only (site must be in right state, response
 * window available for defuse). Actor-side guards (affordability, position,
 * liveness, side) are in rules.js — they must pass before calling here.
 *
 * Three event kinds:
 *   { kind: 'plant',  actorUUID, matchMs, defenderUUIDs }
 *   { kind: 'defuse', actorUUID, matchMs }
 *   { kind: 'tick',   matchMs }                   // expiry check
 *
 * Return shape:
 *   { site, armedBomb, effects[], siteOutcome? }
 *     - site:         new SiteState (or same if no change)
 *     - armedBomb:    new ArmedBombState or null
 *     - effects:      [{ type, ... }]
 *     - siteOutcome:  { siteId, outcome: 'attackers' | 'defenders' } when
 *                     the site has reached a terminal state
 *
 * Throws on invalid transitions — never silently fall through, per spec §4.2.
 */

import { BOMB_TIMER_MS } from './Constants.js';

export const BOMB_STATE = Object.freeze({
  idle: 'idle',
  armed: 'armed',
  defused: 'defused',
  exploded: 'exploded',
});

/**
 * Single entry point. Dispatches by event kind.
 */
export function transitionBomb(site, armedBomb, event) {
  if (!site) throw new Error('transitionBomb: site is required');
  if (!event?.kind) throw new Error('transitionBomb: event.kind is required');
  switch (event.kind) {
    case 'plant':  return transitionPlant(site, armedBomb, event);
    case 'defuse': return transitionDefuse(site, armedBomb, event);
    case 'tick':   return transitionTick(site, armedBomb, event);
    default: throw new Error(`transitionBomb: unknown event kind "${event.kind}"`);
  }
}

// ── Transitions ───────────────────────────────────────────────────

function transitionPlant(site, armedBomb, event) {
  if (site.state !== BOMB_STATE.idle) {
    throw new Error(`plant: site ${site.id} in state "${site.state}", expected "idle"`);
  }
  if (armedBomb) {
    throw new Error(`plant: site ${site.id} already has an armedBomb entry`);
  }
  if (!event.actorUUID) throw new Error('plant: actorUUID required');
  if (!Number.isFinite(event.matchMs)) throw new Error('plant: matchMs required');
  if (!Array.isArray(event.defenderUUIDs)) {
    throw new Error('plant: defenderUUIDs required (array of defender player UUIDs)');
  }

  const defenderResponseAvailable = {};
  for (const uuid of event.defenderUUIDs) defenderResponseAvailable[uuid] = true;

  return {
    site: { ...site, state: BOMB_STATE.armed },
    armedBomb: {
      siteId: site.id,
      armedByPlayerUUID: event.actorUUID,
      armedAtMatchMs: event.matchMs,
      expiresAtMatchMs: event.matchMs + BOMB_TIMER_MS,
      defenderResponseAvailable,
    },
    effects: [{
      type: 'bomb-planted',
      siteId: site.id,
      actorUUID: event.actorUUID,
      matchMs: event.matchMs,
      expiresAtMatchMs: event.matchMs + BOMB_TIMER_MS,
    }],
    siteOutcome: null,   // not terminal yet; attack only wins on expiry
  };
}

function transitionDefuse(site, armedBomb, event) {
  if (site.state !== BOMB_STATE.armed) {
    throw new Error(`defuse: site ${site.id} in state "${site.state}", expected "armed"`);
  }
  if (!armedBomb) {
    throw new Error(`defuse: site ${site.id} has no armedBomb entry`);
  }
  if (!event.actorUUID) throw new Error('defuse: actorUUID required');
  if (!armedBomb.defenderResponseAvailable?.[event.actorUUID]) {
    // This is a state-machine rejection — rules.js should catch it first
    // but if a bug slips through, blow up loudly.
    throw new Error(
      `defuse: defender ${event.actorUUID} has no response window on site ${site.id}`,
    );
  }

  return {
    site: { ...site, state: BOMB_STATE.defused, resolvedInHalf: event.halfNumber ?? null },
    armedBomb: null,
    effects: [{
      type: 'bomb-defused',
      siteId: site.id,
      actorUUID: event.actorUUID,
      matchMs: event.matchMs,
      expiresAtMatchMs: armedBomb.expiresAtMatchMs,
    }],
    siteOutcome: { siteId: site.id, outcome: 'defenders' },
  };
}

function transitionTick(site, armedBomb, event) {
  // Tick only matters for ARMED sites — any other state is a no-op.
  if (site.state !== BOMB_STATE.armed) {
    return { site, armedBomb, effects: [], siteOutcome: null };
  }
  if (!armedBomb) {
    // ARMED state without an armedBomb record would be a data-consistency
    // bug. Loud error rather than silent correction.
    throw new Error(`tick: site ${site.id} is ARMED but has no armedBomb record`);
  }

  // Two explosion triggers (per user feedback: defuse-by-seconds doesn't
  // fit a productivity app where "your turn" = "your next task completion,"
  // which can be minutes apart):
  //
  //   1. All defenders' response windows consumed — every defender has
  //      had at least one turn since plant without defusing. This is the
  //      primary trigger in normal play.
  //   2. Timer expired — fallback for edge cases (e.g. a dead defender who
  //      can't afford respawn, so their window is stuck at true). Set
  //      generously in Constants.js — 10+ minutes — specifically so it
  //      almost never fires before the turn-based trigger in regular play.
  const windows = armedBomb.defenderResponseAvailable || {};
  const windowCount = Object.keys(windows).length;
  const allWindowsConsumed = windowCount > 0
    && Object.values(windows).every((v) => v === false);
  const timerExpired = event.matchMs >= armedBomb.expiresAtMatchMs;

  if (!allWindowsConsumed && !timerExpired) {
    return { site, armedBomb, effects: [], siteOutcome: null };
  }

  return {
    site: { ...site, state: BOMB_STATE.exploded, resolvedInHalf: event.halfNumber ?? null },
    armedBomb: null,
    effects: [{
      type: 'bomb-exploded',
      siteId: site.id,
      actorUUID: armedBomb.armedByPlayerUUID,
      matchMs: event.matchMs,
      reason: allWindowsConsumed ? 'all-windows-consumed' : 'timer',
    }],
    siteOutcome: { siteId: site.id, outcome: 'attackers' },
  };
}

// ── Helpers for turn resolver ──────────────────────────────────────

/**
 * When any defender takes a turn while a site is armed, their response window
 * for that site is consumed — regardless of whether they chose to defuse.
 * (Spec §3.4: "any action consumes the response window for every currently-
 * armed site.")
 *
 * Pure: returns a new armedBombs map with the actor's flags cleared.
 */
export function consumeResponseWindow(armedBombs, defenderUUID) {
  if (!armedBombs) return armedBombs;
  const next = { ...armedBombs };
  let changed = false;
  for (const [siteId, entry] of Object.entries(armedBombs)) {
    if (!entry) continue;
    if (!entry.defenderResponseAvailable?.[defenderUUID]) continue;
    next[siteId] = {
      ...entry,
      defenderResponseAvailable: { ...entry.defenderResponseAvailable, [defenderUUID]: false },
    };
    changed = true;
  }
  return changed ? next : armedBombs;
}

/**
 * Convenience: sweep every site through a tick event. Returns:
 *   { sites, armedBombs, effects, outcomes }
 * where `outcomes` collects any site-round outcomes produced this tick
 * (i.e. sites that went EXPLODED).
 */
export function tickAllBombs(sites, armedBombs, matchMs, halfNumber) {
  let nextSites = sites;
  let nextArmed = armedBombs;
  const effects = [];
  const outcomes = [];
  for (const [siteId, site] of Object.entries(sites || {})) {
    if (!site) continue;
    const armed = armedBombs?.[siteId] || null;
    const r = transitionTick(site, armed, { kind: 'tick', matchMs, halfNumber });
    if (r.site === site && r.armedBomb === armed && r.effects.length === 0) continue;
    nextSites = nextSites === sites ? { ...sites } : nextSites;
    nextSites[siteId] = r.site;
    nextArmed = nextArmed === armedBombs ? { ...armedBombs } : nextArmed;
    nextArmed[siteId] = r.armedBomb;
    effects.push(...r.effects);
    if (r.siteOutcome) outcomes.push({ ...r.siteOutcome, half: halfNumber });
  }
  return { sites: nextSites, armedBombs: nextArmed, effects, outcomes };
}