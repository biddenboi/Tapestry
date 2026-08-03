import {
  TASK_RECOMMENDER_EVENT_TYPES,
  compareTaskRecommenderProtocolEvents,
  isTaskRecommenderProtocolEvent,
  reduceTaskRecommenderDecision,
} from './TaskRecommenderProtocol.js';
import { taskRecommenderV12EvidenceFingerprint } from './TaskRecommenderV12PolicyRegistry.js';

export const TASK_RECOMMENDER_V12_EVIDENCE_REPORT_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_PROMOTION_DECISION_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_EVALUATION_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

function quantile(values = [], probability = 0.5) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * probability) - 1,
  ));
  return sorted[index];
}

function mean(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleVariance(values = []) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0)
    / (values.length - 1);
}

function decisionGroups(events = []) {
  const byDecision = new Map();
  for (const event of events.filter(isTaskRecommenderProtocolEvent).sort(
    compareTaskRecommenderProtocolEvents,
  )) {
    if (!byDecision.has(event.decisionUUID)) byDecision.set(event.decisionUUID, []);
    byDecision.get(event.decisionUUID).push(event);
  }
  return byDecision;
}

function policyAssignment(created) {
  const assignment = created?.payload?.policyAssignment
    || created?.payload?.policyDecision?.evaluationAssignment
    || null;
  if (assignment?.runtime !== 'v12' || !assignment.policyUUID) return null;
  return assignment;
}

function resolvedEvidence(decisionEvents, halfLifeMs) {
  const created = decisionEvents.find((event) => (
    event.type === TASK_RECOMMENDER_EVENT_TYPES.decisionCreated
  ));
  if (!created) return null;
  const assignment = policyAssignment(created);
  if (!assignment) return null;
  const state = reduceTaskRecommenderDecision(decisionEvents, created.decisionUUID);
  if (!['skipped', 'session-finished', 'completed'].includes(state.status)) return null;
  const decisionMs = new Date(created.occurredAt).getTime();
  const rewards = decisionEvents
    .filter((event) => event.type === TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished)
    .map((event) => {
      const rewardHours = Math.max(0, finite(event.payload?.productiveSeconds)) / 3600;
      const rewardAt = event.payload?.sessionFinishedAt || event.occurredAt;
      const rewardMs = new Date(rewardAt).getTime();
      const elapsedMs = Number.isFinite(rewardMs) && Number.isFinite(decisionMs)
        ? Math.max(0, rewardMs - decisionMs)
        : 0;
      return {
        rewardHours,
        discountedRewardHours: rewardHours * (0.5 ** (elapsedMs / halfLifeMs)),
      };
    });
  const observedImmediateWorkHours = rewards.reduce((sum, atom) => sum + atom.rewardHours, 0);
  const discountedVerifiedWorkHours = rewards.reduce(
    (sum, atom) => sum + atom.discountedRewardHours,
    0,
  );
  const predicted = Number(created.payload?.policyDecision?.selected?.predictedImmediateWorkHours);
  const assignmentProbability = Number(assignment.assignmentProbability);
  return {
    decisionUUID: created.decisionUUID,
    policyUUID: String(assignment.policyUUID),
    policyRole: assignment.policyRole || 'unknown',
    experimentUUID: assignment.experimentUUID || null,
    assignmentMethod: assignment.assignmentMethod || null,
    assignmentProbability: Number.isFinite(assignmentProbability)
      && assignmentProbability > 0
      && assignmentProbability <= 1
      ? assignmentProbability
      : null,
    occurredAt: created.occurredAt,
    observationSessionUUID: created.payload?.observationSessionUUID || null,
    observedImmediateWorkHours,
    discountedVerifiedWorkHours,
    predictedImmediateWorkHours: Number.isFinite(predicted) ? Math.max(0, predicted) : null,
    scoringMs: Number.isFinite(Number(created.payload?.deviceEvidence?.scoringMs))
      ? Math.max(0, Number(created.payload.deviceEvidence.scoringMs))
      : null,
    totalMs: Number.isFinite(Number(created.payload?.deviceEvidence?.totalMs))
      ? Math.max(0, Number(created.payload.deviceEvidence.totalMs))
      : null,
    checkpointBytes: Number.isFinite(Number(assignment.checkpointBytes))
      ? Math.max(0, Number(assignment.checkpointBytes))
      : null,
  };
}

function summarizePolicy(rows = [], trainingEvidence = null) {
  const rewardValues = rows.map((row) => row.discountedVerifiedWorkHours);
  const immediateValues = rows.map((row) => row.observedImmediateWorkHours);
  const calibration = rows.filter((row) => row.predictedImmediateWorkHours != null);
  const calibrationErrors = calibration.map((row) => (
    row.predictedImmediateWorkHours - row.observedImmediateWorkHours
  ));
  const assignmentWeights = rows
    .filter((row) => row.assignmentProbability != null)
    .map((row) => 1 / row.assignmentProbability);
  const weightSum = assignmentWeights.reduce((sum, value) => sum + value, 0);
  const squaredWeightSum = assignmentWeights.reduce((sum, value) => sum + value ** 2, 0);
  const activeDays = new Set(rows.map((row) => String(row.occurredAt).slice(0, 10)));
  const sessionStarts = new Map();
  for (const row of rows) {
    if (!row.observationSessionUUID) continue;
    const timestamp = new Date(row.occurredAt).getTime();
    const previous = sessionStarts.get(String(row.observationSessionUUID));
    if (previous == null || timestamp < previous) {
      sessionStarts.set(String(row.observationSessionUUID), timestamp);
    }
  }
  const orderedSessions = [...sessionStarts.values()].sort((left, right) => left - right);
  const returnIntervals = orderedSessions.slice(1).map((timestamp, index) => (
    Math.max(0, timestamp - orderedSessions[index])
  ));
  const scoringSamples = rows.map((row) => row.scoringMs).filter((value) => value != null);
  const totalSamples = rows.map((row) => row.totalMs).filter((value) => value != null);
  const checkpointSamples = rows
    .map((row) => row.checkpointBytes)
    .filter((value) => value != null);
  const resolvedTraining = trainingEvidence || {};
  return Object.freeze({
    policyUUID: rows[0]?.policyUUID || null,
    policyRole: rows[0]?.policyRole || 'unknown',
    experimentUUIDs: [...new Set(rows.map((row) => row.experimentUUID).filter(Boolean))],
    assignmentMethods: [...new Set(rows.map((row) => row.assignmentMethod).filter(Boolean))],
    resolvedDecisions: rows.length,
    activeDays: activeDays.size,
    observationSessions: orderedSessions.length,
    returnIntervals: Object.freeze({
      count: returnIntervals.length,
      meanMs: returnIntervals.length ? mean(returnIntervals) : null,
      medianMs: quantile(returnIntervals, 0.5),
      p90Ms: quantile(returnIntervals, 0.9),
    }),
    discountedVerifiedWork: Object.freeze({
      totalHours: rewardValues.reduce((sum, value) => sum + value, 0),
      meanHoursPerDecision: mean(rewardValues),
      sampleVariance: sampleVariance(rewardValues),
    }),
    immediateVerifiedWork: Object.freeze({
      totalHours: immediateValues.reduce((sum, value) => sum + value, 0),
      meanHoursPerDecision: mean(immediateValues),
    }),
    prequentialCalibration: Object.freeze({
      count: calibration.length,
      meanAbsoluteErrorHours: calibrationErrors.length
        ? mean(calibrationErrors.map(Math.abs))
        : null,
      rootMeanSquaredErrorHours: calibrationErrors.length
        ? Math.sqrt(mean(calibrationErrors.map((value) => value ** 2)))
        : null,
      meanPredictedHours: calibration.length
        ? mean(calibration.map((row) => row.predictedImmediateWorkHours))
        : null,
      meanObservedHours: calibration.length
        ? mean(calibration.map((row) => row.observedImmediateWorkHours))
        : null,
    }),
    assignmentSupport: Object.freeze({
      exactProbabilityCount: assignmentWeights.length,
      effectiveSampleSize: squaredWeightSum > 0 ? weightSum ** 2 / squaredWeightSum : 0,
    }),
    device: Object.freeze({
      scoringSampleCount: scoringSamples.length,
      warmScoringP95Ms: quantile(scoringSamples, 0.95),
      totalP95Ms: quantile(totalSamples, 0.95),
      checkpointBytes: checkpointSamples.length ? Math.max(...checkpointSamples) : (
        Number.isFinite(Number(resolvedTraining.checkpointBytes))
          ? Number(resolvedTraining.checkpointBytes)
          : null
      ),
      trainingWallTimeMs: Number.isFinite(Number(resolvedTraining.trainingWallTimeMs))
        ? Math.max(0, Number(resolvedTraining.trainingWallTimeMs))
        : null,
      energySensitiveDeferrals: Math.max(
        0,
        Math.floor(finite(resolvedTraining.energySensitiveDeferrals)),
      ),
      energyPolicyViolations: Math.max(
        0,
        Math.floor(finite(resolvedTraining.energyPolicyViolations)),
      ),
    }),
  });
}

export function buildTaskRecommenderV12EvidenceReport(events = [], options = {}) {
  const halfLifeMs = Math.max(1, finite(
    options.halfLifeMs,
    TASK_RECOMMENDER_V12_EVALUATION_HALF_LIFE_MS,
  ));
  const rows = [];
  for (const decisionEvents of decisionGroups(events).values()) {
    const row = resolvedEvidence(decisionEvents, halfLifeMs);
    if (row) rows.push(row);
  }
  rows.sort((left, right) => (
    String(left.occurredAt).localeCompare(String(right.occurredAt))
      || left.decisionUUID.localeCompare(right.decisionUUID)
  ));
  const byPolicy = new Map();
  for (const row of rows) {
    if (!byPolicy.has(row.policyUUID)) byPolicy.set(row.policyUUID, []);
    byPolicy.get(row.policyUUID).push(row);
  }
  const policyMetrics = Object.fromEntries([...byPolicy.entries()].map(([policyUUID, entries]) => [
    policyUUID,
    summarizePolicy(entries, options.trainingEvidenceByPolicy?.[policyUUID]),
  ]));
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const report = {
    evidenceReportSchemaVersion: TASK_RECOMMENDER_V12_EVIDENCE_REPORT_SCHEMA_VERSION,
    runtime: 'v12',
    objective: 'thirty-day-discounted-verified-work-hours',
    halfLifeMs,
    generatedAt,
    resolvedDecisionCount: rows.length,
    operational: Object.freeze({
      energySensitiveDeferrals: Math.max(
        0,
        Math.floor(finite(options.energySensitiveDeferrals)),
      ),
      energyPolicyViolations: Math.max(
        0,
        Math.floor(finite(options.energyPolicyViolations)),
      ),
    }),
    policyMetrics,
  };
  return Object.freeze({
    ...report,
    evidenceFingerprint: taskRecommenderV12EvidenceFingerprint(report),
  });
}

function policyMetric(report, policyUUID) {
  return report?.policyMetrics?.[policyUUID] || null;
}

export function evaluateTaskRecommenderV12Promotion(
  report,
  candidatePolicyUUID,
  championPolicyUUID,
  options = {},
) {
  const candidate = policyMetric(report, candidatePolicyUUID);
  const champion = policyMetric(report, championPolicyUUID);
  const minimumResolvedDecisions = Math.max(1, Math.floor(finite(
    options.minimumResolvedDecisionsPerArm,
    20,
  )));
  const minimumEffectiveSampleSize = Math.max(1, finite(
    options.minimumEffectiveSampleSizePerArm,
    10,
  ));
  const minimumActiveDays = Math.max(1, Math.floor(finite(options.minimumActiveDays, 3)));
  const minimumReturnIntervals = Math.max(
    0,
    Math.floor(finite(options.minimumReturnIntervals, 2)),
  );
  const nonInferiorityMarginHours = Math.max(0, finite(
    options.nonInferiorityMarginHours,
    0.05,
  ));
  const minimumUpliftHours = Math.max(0, finite(options.minimumUpliftHours, 0));
  const confidenceMultiplier = Math.max(0, finite(options.confidenceMultiplier, 1.645));
  const reasons = [];
  if (!candidate) reasons.push('missing-candidate-evidence');
  if (!champion) reasons.push('missing-champion-evidence');
  for (const [label, metric] of [['candidate', candidate], ['champion', champion]]) {
    if (!metric) continue;
    if (metric.resolvedDecisions < minimumResolvedDecisions) {
      reasons.push(`${label}-resolved-decisions-below-gate`);
    }
    if (metric.assignmentSupport.effectiveSampleSize < minimumEffectiveSampleSize) {
      reasons.push(`${label}-effective-sample-size-below-gate`);
    }
    if (metric.activeDays < minimumActiveDays) reasons.push(`${label}-active-days-below-gate`);
    if (metric.returnIntervals.count < minimumReturnIntervals) {
      reasons.push(`${label}-return-intervals-below-gate`);
    }
  }

  const candidateMean = candidate?.discountedVerifiedWork.meanHoursPerDecision ?? 0;
  const championMean = champion?.discountedVerifiedWork.meanHoursPerDecision ?? 0;
  const difference = candidateMean - championMean;
  const standardError = candidate && champion ? Math.sqrt(
    candidate.discountedVerifiedWork.sampleVariance / Math.max(1, candidate.resolvedDecisions)
      + champion.discountedVerifiedWork.sampleVariance / Math.max(1, champion.resolvedDecisions),
  ) : Infinity;
  const conservativeDifference = difference - confidenceMultiplier * standardError;
  const uplift = conservativeDifference >= minimumUpliftHours;
  const nonInferior = conservativeDifference >= -nonInferiorityMarginHours;
  if (!uplift && !nonInferior) reasons.push('discounted-verified-work-effectiveness-gate-failed');

  const maximumWarmScoringP95Ms = Math.max(1, finite(
    options.maximumWarmScoringP95Ms,
    100,
  ));
  const maximumCheckpointBytes = Math.max(1, finite(
    options.maximumCheckpointBytes,
    2 * 1024 * 1024,
  ));
  const maximumTrainingWallTimeMs = Math.max(1, finite(
    options.maximumTrainingWallTimeMs,
    60_000,
  ));
  if (candidate) {
    if (candidate.device.warmScoringP95Ms == null) reasons.push('missing-candidate-latency-evidence');
    else if (candidate.device.warmScoringP95Ms > maximumWarmScoringP95Ms) {
      reasons.push('candidate-latency-budget-exceeded');
    }
    if (candidate.device.checkpointBytes == null) reasons.push('missing-candidate-checkpoint-size');
    else if (candidate.device.checkpointBytes > maximumCheckpointBytes) {
      reasons.push('candidate-checkpoint-budget-exceeded');
    }
    if (candidate.device.trainingWallTimeMs == null) reasons.push('missing-candidate-training-time');
    else if (candidate.device.trainingWallTimeMs > maximumTrainingWallTimeMs) {
      reasons.push('candidate-training-time-budget-exceeded');
    }
    if (candidate.device.energyPolicyViolations > 0) reasons.push('candidate-energy-policy-violation');
  }

  const effectivenessGate = Object.freeze({
    eligible: Boolean(candidate && champion && (uplift || nonInferior)),
    criterion: uplift ? 'uplift' : nonInferior ? 'non-inferiority' : 'failed',
    candidateMeanDiscountedWorkHours: candidateMean,
    championMeanDiscountedWorkHours: championMean,
    rawDifferenceHours: difference,
    standardErrorHours: Number.isFinite(standardError) ? standardError : null,
    conservativeDifferenceHours: Number.isFinite(conservativeDifference)
      ? conservativeDifference
      : null,
    nonInferiorityMarginHours,
    minimumUpliftHours,
  });
  const feasibilityReasons = reasons.filter((reason) => (
    reason.includes('latency')
      || reason.includes('checkpoint')
      || reason.includes('training-time')
      || reason.includes('energy-policy')
  ));
  if (Math.max(0, finite(report?.operational?.energyPolicyViolations)) > 0) {
    reasons.push('runtime-energy-policy-violation');
    feasibilityReasons.push('runtime-energy-policy-violation');
  }
  const decision = {
    promotionDecisionSchemaVersion: TASK_RECOMMENDER_V12_PROMOTION_DECISION_SCHEMA_VERSION,
    runtime: 'v12',
    candidatePolicyUUID: String(candidatePolicyUUID),
    championPolicyUUID: String(championPolicyUUID),
    evidenceFingerprint: report?.evidenceFingerprint || null,
    effectiveness: effectivenessGate,
    feasibility: Object.freeze({
      eligible: feasibilityReasons.length === 0,
      maximumWarmScoringP95Ms,
      maximumCheckpointBytes,
      maximumTrainingWallTimeMs,
      energySensitiveDeferrals: candidate?.device?.energySensitiveDeferrals ?? null,
      reasons: feasibilityReasons,
    }),
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
  };
  return Object.freeze({
    ...decision,
    decisionFingerprint: taskRecommenderV12EvidenceFingerprint(decision),
  });
}
