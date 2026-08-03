import { getMatchDurationMs } from './MatchContracts.js';
import { getAversionWeight, getUrgencyWeight } from '../tasks/Tasks.js';
import { calculateWeightedEffectDuration } from './EffectIntervals.js';

export const MATCH_PROMISE_POLICY_ID = 'match-promise-v1';
export const MATCH_PROMISE_POLICY_VERSION = 1;
export const MATCH_PROMISE_MAX_SCALAR = 1.5;
export const MATCH_POINT_INTERVAL_MS = 10_000;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function iso(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function time(value, fallback = NaN) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function matchSupportsPromiseRewards(match) {
  return match?.rulesSnapshot?.scoreRewardPolicy === MATCH_PROMISE_POLICY_ID;
}

export function buildMatchPromiseContract({
  match,
  task,
  activeEffects = [],
  promisedMs = 0,
  acceptedAt = new Date(),
} = {}) {
  if (!match?.UUID || !task?.UUID || !matchSupportsPromiseRewards(match)) return null;
  const acceptedAtISO = iso(acceptedAt);
  const acceptedAtMs = time(acceptedAtISO, Date.now());
  const matchDurationMs = Math.max(0, getMatchDurationMs(match));
  const matchStartedAt = iso(match.lockedAt || match.createdAt || acceptedAtISO);
  const matchStartedAtMs = time(matchStartedAt, acceptedAtMs);
  const matchEndsAtMs = matchStartedAtMs + matchDurationMs;
  const maximumPromiseMs = Math.max(0, Math.min(matchDurationMs, matchEndsAtMs - acceptedAtMs));
  const acceptedPromiseMs = Math.min(maximumPromiseMs, Math.max(0, finite(promisedMs)));
  const taskAversionMultiplier = Math.max(0, finite(getAversionWeight(task), 1));
  const taskUrgencyMultiplier = Math.max(0, finite(getUrgencyWeight(task, acceptedAtMs), 1));
  const effects = (activeEffects || []).map((effect) => ({
    UUID: effect?.UUID || null,
    eventUUID: effect?.eventUUID || null,
    label: String(effect?.label || 'Event effect'),
    multiplierValue: Math.max(0, finite(effect?.multiplierValue, 1)),
    startsAt: iso(effect?.startsAt || effect?.appliedAt || acceptedAtISO),
    endsAt: iso(effect?.endsAt || effect?.expiresAt || new Date(matchEndsAtMs)),
    stackingRule: ['multiply', 'additive', 'highest'].includes(effect?.stackingRule)
      ? effect.stackingRule
      : 'multiply',
  }));
  const eventMultiplier = effects.reduce((product, effect) => product * effect.multiplierValue, 1);
  return Object.freeze({
    policyId: MATCH_PROMISE_POLICY_ID,
    policyVersion: MATCH_PROMISE_POLICY_VERSION,
    matchUUID: String(match.UUID),
    acceptedAt: acceptedAtISO,
    matchStartedAt,
    matchEndsAt: new Date(matchEndsAtMs).toISOString(),
    matchDurationMs,
    maximumPromiseMs,
    promisedMs: acceptedPromiseMs,
    taskAversionMultiplier,
    taskUrgencyMultiplier,
    taskMultiplier: taskAversionMultiplier * taskUrgencyMultiplier,
    eventMultiplier,
    eventEffects: effects,
    maxPromiseScalar: Math.max(1, finite(match.rulesSnapshot?.maxPromiseScalar, MATCH_PROMISE_MAX_SCALAR)),
  });
}

export function calculateMatchPromiseScore({
  contract,
  activeDurationMs = 0,
  boundaryAt = null,
  activityIntervals = [],
} = {}) {
  if (!contract || contract.policyId !== MATCH_PROMISE_POLICY_ID) return null;
  const acceptedAtMs = time(contract.acceptedAt, 0);
  const matchEndsAtMs = time(contract.matchEndsAt, acceptedAtMs);
  const requestedBoundaryMs = boundaryAt ? time(boundaryAt, matchEndsAtMs) : matchEndsAtMs;
  const effectiveBoundaryMs = Math.min(matchEndsAtMs, Math.max(acceptedAtMs, requestedBoundaryMs));
  const eligibleWindowMs = Math.max(0, effectiveBoundaryMs - acceptedAtMs);
  const eligibleActiveMs = Math.min(
    Math.max(0, finite(activeDurationMs)),
    eligibleWindowMs,
    Math.max(0, finite(contract.matchDurationMs)),
  );
  const basePoints = Math.floor(eligibleActiveMs / MATCH_POINT_INTERVAL_MS);
  const promisedMs = Math.max(0, finite(contract.promisedMs));
  const matchDurationMs = Math.max(1, finite(contract.matchDurationMs, 1));
  const promiseRatio = Math.min(1, promisedMs / matchDurationMs);
  const promiseMet = promisedMs > 0 && eligibleActiveMs >= promisedMs;
  const maxPromiseScalar = Math.max(1, finite(contract.maxPromiseScalar, MATCH_PROMISE_MAX_SCALAR));
  const attainablePromiseScalar = 1 + ((maxPromiseScalar - 1) * promiseRatio);
  const promiseScalar = promiseMet ? attainablePromiseScalar : 1;
  const taskMultiplier = Math.max(0, finite(contract.taskMultiplier, 1));
  const intervalResult = activityIntervals?.length && contract.eventEffects?.length
    ? calculateWeightedEffectDuration({
        activityIntervals,
        effectIntervals: contract.eventEffects,
        startsAt: contract.acceptedAt,
        endsAt: new Date(effectiveBoundaryMs).toISOString(),
        maximumActiveMs: eligibleActiveMs,
      })
    : null;
  const eventMultiplier = intervalResult?.activeMs > 0
    ? intervalResult.averageMultiplier
    : Math.max(0, finite(contract.eventMultiplier, 1));
  const totalMultiplier = taskMultiplier * eventMultiplier * promiseScalar;
  return Object.freeze({
    policyId: MATCH_PROMISE_POLICY_ID,
    policyVersion: MATCH_PROMISE_POLICY_VERSION,
    boundaryAt: new Date(effectiveBoundaryMs).toISOString(),
    eligibleActiveMs,
    basePoints,
    taskMultiplier,
    taskAversionMultiplier: Math.max(0, finite(contract.taskAversionMultiplier, 1)),
    taskUrgencyMultiplier: Math.max(0, finite(contract.taskUrgencyMultiplier, 1)),
    eventMultiplier,
    effectSegments: intervalResult?.segments || [],
    effectWeightedActiveMs: intervalResult?.weightedActiveMs || eligibleActiveMs * eventMultiplier,
    promisedMs,
    promiseRatio,
    promiseMet,
    attainablePromiseScalar,
    promiseScalar,
    totalMultiplier,
    points: Math.max(0, Math.floor(basePoints * totalMultiplier)),
  });
}

export function formatMatchPromiseScalar(contract, promisedMs = contract?.promisedMs || 0) {
  const duration = Math.max(1, finite(contract?.matchDurationMs, 1));
  const ratio = Math.min(1, Math.max(0, finite(promisedMs)) / duration);
  const maximum = Math.max(1, finite(contract?.maxPromiseScalar, MATCH_PROMISE_MAX_SCALAR));
  return 1 + ((maximum - 1) * ratio);
}
