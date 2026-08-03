export const TASK_RECOMMENDER_V12_RETURN_SCHEMA_VERSION = 3;
export const TASK_RECOMMENDER_V12_RETURN_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
export const TASK_RECOMMENDER_V12_RETRACE_LAMBDA = 0.8;
export const TASK_RECOMMENDER_V12_MAX_TRACE_STEPS = 64;
export const TASK_RECOMMENDER_V12_MAX_TRACE_ELAPSED_MS = 30 * 24 * 60 * 60 * 1000;
export const TASK_RECOMMENDER_V12_MIN_TRACE_WEIGHT = 1e-4;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const probability = (value, allowZero = false) => {
  const number = Number(value);
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0) && number <= 1
    ? number
    : null;
};

const timestamp = (value, fallback = 0) => {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : fallback;
};

export function taskRecommenderV12ContinuousDiscount(
  elapsedMs,
  halfLifeMs = TASK_RECOMMENDER_V12_RETURN_HALF_LIFE_MS,
) {
  const elapsed = Math.max(0, finiteNumber(elapsedMs));
  const halfLife = Math.max(1, finiteNumber(halfLifeMs, TASK_RECOMMENDER_V12_RETURN_HALF_LIFE_MS));
  return Math.exp(-Math.LN2 * elapsed / halfLife);
}

function normalizedRewardAtoms(step, occurredAtMs, halfLifeMs) {
  if (!Array.isArray(step.rewardAtoms)) {
    const rewardHours = Math.max(0, finiteNumber(step.rewardHours));
    return {
      atoms: rewardHours > 0 ? [Object.freeze({
        occurredAt: new Date(occurredAtMs).toISOString(),
        elapsedMs: 0,
        rawRewardHours: rewardHours,
        discountedRewardHours: rewardHours,
        timingVerified: step.rewardTimingVerified !== false,
      })] : [],
      timingVerified: step.rewardTimingVerified !== false,
    };
  }
  let timingVerified = step.rewardTimingVerified !== false;
  const atoms = step.rewardAtoms.map((atom) => {
    const atomMs = timestamp(atom?.occurredAt, NaN);
    const validTimestamp = Number.isFinite(atomMs) && atomMs >= occurredAtMs;
    const verifiedTimestamp = validTimestamp && atom?.timingVerified !== false;
    const elapsedMs = verifiedTimestamp ? atomMs - occurredAtMs : 0;
    const rawRewardHours = Math.max(0, finiteNumber(
      atom?.rewardHours,
      Math.max(0, finiteNumber(atom?.productiveSeconds)) / 3600,
    ));
    if (!verifiedTimestamp) timingVerified = false;
    return Object.freeze({
      rewardAtomSchemaVersion: Math.max(1, Math.floor(finiteNumber(
        atom?.rewardAtomSchemaVersion,
        1,
      ))),
      eventUUID: atom?.eventUUID == null ? null : String(atom.eventUUID),
      occurredAt: new Date(validTimestamp ? atomMs : occurredAtMs).toISOString(),
      elapsedMs,
      rawRewardHours,
      discountedRewardHours: rawRewardHours * taskRecommenderV12ContinuousDiscount(
        elapsedMs,
        halfLifeMs,
      ),
      timingVerified: verifiedTimestamp,
    });
  });
  return { atoms, timingVerified };
}

export function buildTaskRecommenderV12DecisionTransitions(steps = [], options = {}) {
  const ordered = [...steps]
    .filter((step) => step?.decisionUUID)
    .map((step, index) => ({ ...step, inputIndex: index }))
    .sort((left, right) => (
      timestamp(left.occurredAt) - timestamp(right.occurredAt)
      || finiteNumber(left.decisionSequence) - finiteNumber(right.decisionSequence)
      || left.inputIndex - right.inputIndex
    ));
  const observationEndMs = Math.max(
    timestamp(options.observationEndAt),
    timestamp(ordered.at(-1)?.occurredAt),
  );
  const finalBootstrapValue = Number.isFinite(Number(options.finalBootstrapValue))
    ? Number(options.finalBootstrapValue)
    : finiteNumber(ordered.at(-1)?.qValue);
  return ordered.map((step, index) => {
    const next = ordered[index + 1] || null;
    const occurredAtMs = timestamp(step.occurredAt);
    const nextAtMs = next ? timestamp(next.occurredAt, occurredAtMs) : observationEndMs;
    const elapsedMs = Math.max(0, nextAtMs - occurredAtMs);
    const reward = normalizedRewardAtoms(step, occurredAtMs, options.halfLifeMs);
    const rawRewardHours = reward.atoms.reduce(
      (sum, atom) => sum + atom.rawRewardHours,
      0,
    );
    const discountedRewardHours = reward.atoms.reduce(
      (sum, atom) => sum + atom.discountedRewardHours,
      0,
    );
    const behaviorProbability = probability(step.behaviorProbability);
    const targetProbability = probability(step.targetProbability, true);
    const propensityUsable = behaviorProbability != null && targetProbability != null;
    const importanceRatio = propensityUsable ? targetProbability / behaviorProbability : null;
    const terminal = Boolean(step.terminal);
    return Object.freeze({
      returnSchemaVersion: TASK_RECOMMENDER_V12_RETURN_SCHEMA_VERSION,
      decisionUUID: String(step.decisionUUID),
      nextDecisionUUID: next ? String(next.decisionUUID) : null,
      occurredAt: new Date(occurredAtMs).toISOString(),
      elapsedMs,
      discount: taskRecommenderV12ContinuousDiscount(elapsedMs, options.halfLifeMs),
      rewardHours: discountedRewardHours,
      rawRewardHours,
      rewardTimingDiscountHours: rawRewardHours - discountedRewardHours,
      rewardTimingVerified: reward.timingVerified,
      rewardAtoms: Object.freeze(reward.atoms),
      qValue: finiteNumber(step.qValue),
      nextStateValue: terminal ? 0 : (next ? finiteNumber(next.qValue) : finalBootstrapValue),
      behaviorProbability,
      targetProbability,
      propensityUsable,
      importanceRatio,
      observationSessionUUID: step.observationSessionUUID == null
        ? null
        : String(step.observationSessionUUID),
      nextObservationSessionUUID: next?.observationSessionUUID == null
        ? null
        : String(next.observationSessionUUID),
      crossesObservedReturn: Boolean(
        next
        && step.observationSessionUUID
        && next.observationSessionUUID
        && String(step.observationSessionUUID) !== String(next.observationSessionUUID)
      ),
      terminal,
      // Reaching the end of locally observed data is right-censoring, not an absorbing state.
      censored: !next && !terminal,
    });
  });
}

function traceCoefficient(transition, lambda) {
  if (!transition?.propensityUsable) return 0;
  return lambda * Math.min(1, Math.max(0, transition.importanceRatio));
}

export function computeTaskRecommenderV12RetraceTargets(transitions = [], options = {}) {
  const lambda = Math.max(0, Math.min(1, finiteNumber(
    options.lambda,
    TASK_RECOMMENDER_V12_RETRACE_LAMBDA,
  )));
  const maxTraceSteps = Math.max(1, Math.floor(finiteNumber(
    options.maxTraceSteps,
    TASK_RECOMMENDER_V12_MAX_TRACE_STEPS,
  )));
  const maxTraceElapsedMs = Math.max(0, finiteNumber(
    options.maxTraceElapsedMs,
    TASK_RECOMMENDER_V12_MAX_TRACE_ELAPSED_MS,
  ));
  const minimumTraceWeight = Math.max(0, finiteNumber(
    options.minimumTraceWeight,
    TASK_RECOMMENDER_V12_MIN_TRACE_WEIGHT,
  ));
  const diagnostics = {
    transitions: transitions.length,
    censoredBoundaries: transitions.filter((transition) => transition.censored).length,
    missingPropensities: transitions.filter((transition) => !transition.propensityUsable).length,
    clippedImportanceRatios: transitions.filter((transition) => (
      transition.propensityUsable && transition.importanceRatio > 1
    )).length,
    maximumTraceLength: 0,
    meanTraceLength: 0,
    meanAbsoluteDelayedCreditHours: 0,
    rawVerifiedWorkHours: transitions.reduce(
      (sum, transition) => sum + Math.max(0, finiteNumber(transition.rawRewardHours)),
      0,
    ),
    timeDiscountedWorkHours: transitions.reduce(
      (sum, transition) => sum + Math.max(0, finiteNumber(transition.rewardHours)),
      0,
    ),
    rewardTimingDiscountHours: transitions.reduce(
      (sum, transition) => sum + Math.max(0, finiteNumber(transition.rewardTimingDiscountHours)),
      0,
    ),
    unverifiedRewardTimingTransitions: transitions.filter(
      (transition) => !transition.rewardTimingVerified,
    ).length,
    observedReturnBoundaries: transitions.filter(
      (transition) => transition.crossesObservedReturn,
    ).length,
    targetsCrossingObservedReturns: 0,
    traceWeightTerminations: 0,
    traceElapsedTerminations: 0,
    traceStepTerminations: 0,
    unverifiedTimingTerminations: 0,
    unsupportedPropensityTerminations: 0,
  };
  let traceLengthSum = 0;
  let delayedCreditSum = 0;
  const targets = transitions.map((transition, start) => {
    let target = finiteNumber(transition.qValue);
    let weight = 1;
    let elapsedFromStart = 0;
    let traceLength = 0;
    let oneStepTarget = target;
    let crossedObservedReturn = false;
    let terminationReason = null;
    for (let index = start; index < transitions.length && traceLength < maxTraceSteps; index += 1) {
      const current = transitions[index];
      if (index > start && elapsedFromStart > maxTraceElapsedMs) {
        terminationReason = 'elapsed';
        break;
      }
      if (index > start && !current.rewardTimingVerified) {
        terminationReason = 'unverified-reward-timing';
        break;
      }
      const bootstrap = current.terminal ? 0 : finiteNumber(current.nextStateValue);
      const temporalDifference = finiteNumber(current.rewardHours)
        + finiteNumber(current.discount, 1) * bootstrap
        - finiteNumber(current.qValue);
      target += weight * temporalDifference;
      traceLength += 1;
      if (index === start) oneStepTarget = target;
      if (current.terminal) break;
      if (!current.rewardTimingVerified) {
        terminationReason = 'unverified-reward-timing';
        break;
      }
      if (!current.propensityUsable) {
        terminationReason = 'unsupported-propensity-boundary';
        break;
      }
      const next = transitions[index + 1];
      if (!next) break;
      if (!next.propensityUsable) {
        terminationReason = 'unsupported-propensity-boundary';
        break;
      }
      if (current.crossesObservedReturn) crossedObservedReturn = true;
      elapsedFromStart += Math.max(0, finiteNumber(current.elapsedMs));
      weight *= finiteNumber(current.discount, 1) * traceCoefficient(next, lambda);
      if (Math.abs(weight) <= minimumTraceWeight) {
        terminationReason = 'weight';
        break;
      }
    }
    if (!terminationReason && traceLength >= maxTraceSteps && start + traceLength < transitions.length) {
      terminationReason = 'steps';
    }
    if (terminationReason === 'weight') diagnostics.traceWeightTerminations += 1;
    if (terminationReason === 'elapsed') diagnostics.traceElapsedTerminations += 1;
    if (terminationReason === 'steps') diagnostics.traceStepTerminations += 1;
    if (terminationReason === 'unverified-reward-timing') {
      diagnostics.unverifiedTimingTerminations += 1;
    }
    if (terminationReason === 'unsupported-propensity-boundary') {
      diagnostics.unsupportedPropensityTerminations += 1;
    }
    if (crossedObservedReturn) diagnostics.targetsCrossingObservedReturns += 1;
    traceLengthSum += traceLength;
    diagnostics.maximumTraceLength = Math.max(diagnostics.maximumTraceLength, traceLength);
    delayedCreditSum += Math.abs(target - oneStepTarget);
    return Object.freeze({
      decisionUUID: transition.decisionUUID,
      targetWorkHours: target,
      immediateWorkHours: transition.rewardHours,
      verifiedWorkHours: transition.rawRewardHours,
      timeDiscountedImmediateWorkHours: transition.rewardHours,
      rewardTimingDiscountHours: transition.rewardTimingDiscountHours,
      rewardTimingVerified: transition.rewardTimingVerified,
      oneStepTargetWorkHours: oneStepTarget,
      delayedCreditHours: target - oneStepTarget,
      traceLength,
      crossedObservedReturn,
      terminationReason,
      censored: transition.censored,
    });
  });
  if (targets.length) {
    diagnostics.meanTraceLength = traceLengthSum / targets.length;
    diagnostics.meanAbsoluteDelayedCreditHours = delayedCreditSum / targets.length;
  }
  return { targets, diagnostics };
}
