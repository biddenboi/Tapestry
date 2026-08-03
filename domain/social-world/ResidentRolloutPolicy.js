export const RESIDENT_ROLLOUT_STAGE = Object.freeze({
  disabled: 'disabled',
  shadowInternal: 'shadow-internal',
  internalRendering: 'internal-rendering',
  betaFivePercent: 'beta-5-percent',
  cohortTwentyFivePercent: 'cohort-25-percent',
  full: 'full',
});

export const RESIDENT_ROLLOUT_STAGE_ORDER = Object.freeze([
  RESIDENT_ROLLOUT_STAGE.disabled,
  RESIDENT_ROLLOUT_STAGE.shadowInternal,
  RESIDENT_ROLLOUT_STAGE.internalRendering,
  RESIDENT_ROLLOUT_STAGE.betaFivePercent,
  RESIDENT_ROLLOUT_STAGE.cohortTwentyFivePercent,
  RESIDENT_ROLLOUT_STAGE.full,
]);

export const RESIDENT_ROLLOUT_MINIMUM_STAGE_AGE_MS = Object.freeze({
  [RESIDENT_ROLLOUT_STAGE.cohortTwentyFivePercent]: 24 * 60 * 60_000,
  [RESIDENT_ROLLOUT_STAGE.full]: 72 * 60 * 60_000,
});

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function residentRolloutBucket(accountId) {
  if (!accountId) return 100;
  return fnv1a(String(accountId)) % 100;
}

export function evaluateResidentRollout({
  stage = RESIDENT_ROLLOUT_STAGE.disabled,
  accountId,
  internalAccount = false,
} = {}) {
  if (!RESIDENT_ROLLOUT_STAGE_ORDER.includes(stage)) throw new TypeError('Unknown resident rollout stage.');
  const bucket = residentRolloutBucket(accountId);
  const internal = internalAccount === true;
  const inCohort = stage === RESIDENT_ROLLOUT_STAGE.full
    || (stage === RESIDENT_ROLLOUT_STAGE.betaFivePercent && bucket < 5)
    || (stage === RESIDENT_ROLLOUT_STAGE.cohortTwentyFivePercent && bucket < 25);
  const resolutionEnabled = (stage === RESIDENT_ROLLOUT_STAGE.shadowInternal && internal)
    || (stage === RESIDENT_ROLLOUT_STAGE.internalRendering && internal)
    || inCohort;
  const renderingEnabled = (stage === RESIDENT_ROLLOUT_STAGE.internalRendering && internal)
    || inCohort;
  return Object.freeze({
    stage,
    bucket,
    cohort: internal ? 'internal' : inCohort ? `${stage}:${bucket}` : 'control',
    flags: Object.freeze({
      residentResolutionEnabled: resolutionEnabled,
      residentRenderingEnabled: renderingEnabled,
      residentFullLiveEnabled: resolutionEnabled,
      residentAlignedEnabled: resolutionEnabled,
      residentPublicObjectiveEnabled: false,
      residentGenericActiveEnabled: false,
      residentGlobalKillSwitch: false,
    }),
  });
}

export function canAdvanceResidentRollout({
  currentStage,
  nextStage,
  stageStartedAt,
  now = Date.now(),
  guardrailsPassing = false,
  finalSignoff = false,
} = {}) {
  const currentIndex = RESIDENT_ROLLOUT_STAGE_ORDER.indexOf(currentStage);
  const nextIndex = RESIDENT_ROLLOUT_STAGE_ORDER.indexOf(nextStage);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1 || !guardrailsPassing) return false;
  const requiredAge = RESIDENT_ROLLOUT_MINIMUM_STAGE_AGE_MS[nextStage] || 0;
  const started = new Date(stageStartedAt || '').getTime();
  if (requiredAge && (!Number.isFinite(started) || Number(now) - started < requiredAge)) return false;
  return nextStage !== RESIDENT_ROLLOUT_STAGE.full || finalSignoff === true;
}
