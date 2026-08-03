import { encodeTaskRecommenderV12Action } from './TaskRecommenderV12Encoding.js';
import {
  createTaskRecommenderV12PosteriorSampler,
  predictTaskRecommenderV12Action,
} from './TaskRecommenderV12Model.js';
import { createSeededRandom, dot } from './TaskRecommenderV12Math.js';

export const TASK_RECOMMENDER_V12_POLICY_SCHEMA_VERSION = 4;
export const TASK_RECOMMENDER_V12_POLICY_VERSION = 'dual-head-safe-v4';
export const TASK_RECOMMENDER_V12_POLICY_RNG_ALGORITHM = 'fnv1a-mulberry32-box-muller-v1';
export const TASK_RECOMMENDER_V12_DEFAULT_POSTERIOR_SAMPLES = 64;
export const TASK_RECOMMENDER_V12_DEFAULT_TASK_SUPPORT_FLOOR = 0.01;
export const TASK_RECOMMENDER_V12_DEFAULT_DURATION_SUPPORT_FLOOR = 0.01;
export const TASK_RECOMMENDER_V12_DEFAULT_SAFETY_FRACTION = 0.1;
export const TASK_RECOMMENDER_V12_DEFAULT_CONFIDENCE_MULTIPLIER = 1.645;
export const TASK_RECOMMENDER_V12_DEFAULT_MINIMUM_CHAMPION_EVIDENCE = 8;
export const TASK_RECOMMENDER_V12_MAX_REFINEMENTS_PER_TASK = 4;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

function fnv1a(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableKey(candidate = {}) {
  return String(candidate.actionKey || `${candidate.taskUUID || ''}:${candidate.durationSeconds || 0}`);
}

function sortedCandidates(candidates = []) {
  const unique = new Map();
  for (const candidate of candidates) {
    const actionKey = stableKey(candidate);
    if (!actionKey || unique.has(actionKey)) continue;
    unique.set(actionKey, { ...candidate, actionKey });
  }
  return [...unique.values()].sort((left, right) => left.actionKey.localeCompare(right.actionKey));
}

function quantizedGeometricMidpoint(left, right, quantum) {
  const midpoint = Math.sqrt(Math.max(1, left) * Math.max(1, right));
  return Math.round(midpoint / quantum) * quantum;
}

export function refineTaskRecommenderV12DurationSupport(candidates = [], options = {}) {
  const ordered = sortedCandidates(candidates);
  const byTask = new Map();
  for (const candidate of ordered) {
    const taskUUID = String(candidate.taskUUID);
    if (!byTask.has(taskUUID)) byTask.set(taskUUID, []);
    byTask.get(taskUUID).push(candidate);
  }
  const refinements = [];
  for (const taskCandidates of byTask.values()) {
    const durations = [...taskCandidates].sort((left, right) => (
      finiteNumber(left.durationSeconds) - finiteNumber(right.durationSeconds)
    ));
    if (durations.length < 2) continue;
    const means = durations.map((candidate) => finiteNumber(candidate.mean));
    const maximumMean = Math.max(...means);
    const minimumMean = Math.min(...means);
    if (maximumMean - minimumMean <= 1e-10) continue;
    const intervals = new Set();
    means.forEach((mean, index) => {
      if (Math.abs(mean - maximumMean) > 1e-12) return;
      if (index > 0) intervals.add(index - 1);
      if (index < durations.length - 1) intervals.add(index);
    });
    for (const intervalIndex of [...intervals].slice(
      0,
      Math.max(0, Math.floor(finiteNumber(
        options.maxRefinementsPerTask,
        TASK_RECOMMENDER_V12_MAX_REFINEMENTS_PER_TASK,
      ))),
    )) {
      const left = durations[intervalIndex];
      const right = durations[intervalIndex + 1];
      const quantum = Math.max(1, Math.floor(finiteNumber(
        left.durationQuantumSeconds || right.durationQuantumSeconds,
        60,
      )));
      const durationSeconds = quantizedGeometricMidpoint(
        finiteNumber(left.durationSeconds),
        finiteNumber(right.durationSeconds),
        quantum,
      );
      if (durationSeconds <= left.durationSeconds || durationSeconds >= right.durationSeconds) continue;
      refinements.push({
        ...left,
        actionKey: `${left.taskUUID}:${durationSeconds}`,
        durationSeconds,
        encodedAction: null,
        representation: null,
        mean: null,
        epistemicVariance: null,
        epistemicStdDev: null,
      });
    }
  }
  return sortedCandidates([...ordered, ...refinements]);
}

function normalizeProbabilities(values) {
  if (!values.length) return [];
  const weights = values.map((value) => Math.max(0, finiteNumber(value)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const result = total > 0
    ? weights.map((value) => value / total)
    : weights.map(() => 1 / weights.length);
  const correction = 1 - result.reduce((sum, value) => sum + value, 0);
  result[result.length - 1] += correction;
  return result;
}

function flooredProbabilities(values, requestedFloor) {
  if (!values.length) return { probabilities: [], effectiveFloor: 0 };
  const normalized = normalizeProbabilities(values);
  const effectiveFloor = Math.min(
    Math.max(0, finiteNumber(requestedFloor)),
    1 / values.length,
  );
  const residual = Math.max(0, 1 - effectiveFloor * values.length);
  const probabilities = normalized.map((value) => effectiveFloor + residual * value);
  const correction = 1 - probabilities.reduce((sum, value) => sum + value, 0);
  probabilities[probabilities.length - 1] += correction;
  return { probabilities, effectiveFloor };
}

function bestCandidate(candidates, valueFor, random = null) {
  let tied = [];
  let bestValue = -Infinity;
  for (const candidate of candidates) {
    const value = finiteNumber(valueFor(candidate), -Infinity);
    if (value > bestValue) {
      tied = [candidate];
      bestValue = value;
    } else if (value === bestValue) {
      tied.push(candidate);
    }
  }
  if (!tied.length) return null;
  if (tied.length === 1 || typeof random !== 'function') return tied[0];
  return tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))];
}

export function taskRecommenderV12PosteriorFingerprint(model = {}) {
  const posterior = model.posterior || {};
  const safetyPosterior = model.safetyPosterior || {};
  return fnv1a([
    model.modelVersion,
    posterior.updateCount,
    ...(posterior.mean || []),
    ...(posterior.precision || []),
    safetyPosterior.updateCount,
    ...(safetyPosterior.mean || []),
    ...(safetyPosterior.precision || []),
  ].join('|'));
}

export function sampleTaskRecommenderV12PosteriorVotes(
  posterior,
  candidates = [],
  options = {},
) {
  const ordered = sortedCandidates(candidates);
  if (!ordered.length) return { sampleCount: 0, candidates: [], votes: [] };
  if (ordered.some((candidate) => !Array.isArray(candidate.representation)
    || candidate.representation.length !== posterior.width)) {
    throw new RangeError('Policy candidate representation shape mismatch');
  }
  const sampleCount = Math.max(1, Math.min(
    1_024,
    Math.floor(finiteNumber(options.sampleCount, TASK_RECOMMENDER_V12_DEFAULT_POSTERIOR_SAMPLES)),
  ));
  const seed = String(options.seed || 'task-recommender-v12-policy');
  const random = createSeededRandom(`${seed}:posterior`);
  const sampleWeights = typeof options.posteriorSampler === 'function'
    ? options.posteriorSampler
    : createTaskRecommenderV12PosteriorSampler(posterior);
  const counts = new Map(ordered.map((candidate) => [candidate.actionKey, 0]));
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const weights = sampleWeights(random);
    const winner = bestCandidate(
      ordered,
      (candidate) => dot(weights, candidate.representation),
      random,
    );
    counts.set(winner.actionKey, counts.get(winner.actionKey) + 1);
  }
  return {
    sampleCount,
    candidates: ordered,
    votes: ordered.map((candidate) => Object.freeze({
      actionKey: candidate.actionKey,
      taskUUID: String(candidate.taskUUID),
      durationSeconds: Math.max(0, finiteNumber(candidate.durationSeconds)),
      count: counts.get(candidate.actionKey),
      probability: counts.get(candidate.actionKey) / sampleCount,
    })),
  };
}

export function buildTaskRecommenderV12NeutralSupport(candidates = []) {
  const ordered = sortedCandidates(candidates);
  if (!ordered.length) return { actions: [], tasks: [] };
  const byTask = new Map();
  for (const candidate of ordered) {
    const taskUUID = String(candidate.taskUUID);
    if (!byTask.has(taskUUID)) byTask.set(taskUUID, []);
    byTask.get(taskUUID).push(candidate);
  }
  const tasks = [...byTask.entries()].sort(([left], [right]) => left.localeCompare(right));
  const taskProbability = 1 / tasks.length;
  const taskRows = [];
  const actions = [];
  for (const [taskUUID, taskActions] of tasks) {
    const durationConditionalProbability = 1 / taskActions.length;
    taskRows.push(Object.freeze({
      taskUUID,
      voteCount: 0,
      probability: taskProbability,
    }));
    for (const candidate of taskActions) {
      actions.push(Object.freeze({
        actionKey: candidate.actionKey,
        taskUUID,
        durationSeconds: Math.max(0, finiteNumber(candidate.durationSeconds)),
        count: 0,
        probability: 0,
        taskProbability,
        durationConditionalProbability,
        explorationProbability: taskProbability * durationConditionalProbability,
      }));
    }
  }
  const correction = 1 - actions.reduce(
    (sum, action) => sum + action.explorationProbability,
    0,
  );
  if (actions.length && Math.abs(correction) > 0) {
    const last = actions.at(-1);
    actions[actions.length - 1] = Object.freeze({
      ...last,
      explorationProbability: last.explorationProbability + correction,
    });
  }
  return { actions, tasks: taskRows };
}

export function buildTaskRecommenderV12HierarchicalSupport(votes = [], options = {}) {
  const ordered = [...votes].sort((left, right) => stableKey(left).localeCompare(stableKey(right)));
  if (!ordered.length) return {
    actions: [], tasks: [], taskSupportFloor: 0, durationSupportFloorByTask: {},
  };
  const sampleCount = Math.max(1, ordered.reduce((sum, vote) => sum + Math.max(0, finiteNumber(vote.count)), 0));
  const byTask = new Map();
  for (const vote of ordered) {
    const taskUUID = String(vote.taskUUID);
    if (!byTask.has(taskUUID)) byTask.set(taskUUID, []);
    byTask.get(taskUUID).push(vote);
  }
  const tasks = [...byTask.entries()].sort(([left], [right]) => left.localeCompare(right));
  const taskFloorResult = flooredProbabilities(
    tasks.map(([, taskVotes]) => taskVotes.reduce((sum, vote) => sum + finiteNumber(vote.count), 0) / sampleCount),
    options.taskSupportFloor ?? TASK_RECOMMENDER_V12_DEFAULT_TASK_SUPPORT_FLOOR,
  );
  const taskRows = [];
  const actions = [];
  const durationSupportFloorByTask = {};
  tasks.forEach(([taskUUID, taskVotes], taskIndex) => {
    const taskVoteCount = taskVotes.reduce((sum, vote) => sum + Math.max(0, finiteNumber(vote.count)), 0);
    const conditionalRaw = taskVoteCount > 0
      ? taskVotes.map((vote) => Math.max(0, finiteNumber(vote.count)) / taskVoteCount)
      : taskVotes.map(() => 1 / taskVotes.length);
    const durationFloorResult = flooredProbabilities(
      conditionalRaw,
      options.durationSupportFloor ?? TASK_RECOMMENDER_V12_DEFAULT_DURATION_SUPPORT_FLOOR,
    );
    const taskProbability = taskFloorResult.probabilities[taskIndex];
    durationSupportFloorByTask[taskUUID] = durationFloorResult.effectiveFloor;
    taskRows.push(Object.freeze({
      taskUUID,
      voteCount: taskVoteCount,
      probability: taskProbability,
    }));
    taskVotes.forEach((vote, actionIndex) => {
      const durationConditionalProbability = durationFloorResult.probabilities[actionIndex];
      actions.push(Object.freeze({
        ...vote,
        taskProbability,
        durationConditionalProbability,
        explorationProbability: taskProbability * durationConditionalProbability,
      }));
    });
  });
  const correction = 1 - actions.reduce((sum, action) => sum + action.explorationProbability, 0);
  if (actions.length && Math.abs(correction) > 0) {
    const last = actions.at(-1);
    actions[actions.length - 1] = Object.freeze({
      ...last,
      explorationProbability: last.explorationProbability + correction,
    });
  }
  return {
    actions,
    tasks: taskRows,
    taskSupportFloor: taskFloorResult.effectiveFloor,
    durationSupportFloorByTask,
  };
}

export function normalizeTaskRecommenderV12BudgetState(value = {}) {
  const safetyFraction = clamp(
    finiteNumber(value.safetyFraction, TASK_RECOMMENDER_V12_DEFAULT_SAFETY_FRACTION),
    0,
    1,
  );
  const pending = Array.isArray(value.pending) ? value.pending
    .filter((entry) => entry?.decisionUUID)
    .slice(-128)
    .map((entry) => Object.freeze({
      decisionUUID: String(entry.decisionUUID),
      reservedImmediateWorkHours: Math.max(0, finiteNumber(
        entry.reservedImmediateWorkHours,
      )),
      baselineReferenceHours: Math.max(0, finiteNumber(entry.baselineReferenceHours)),
      valueHorizon: 'current-session-verified-work-hours',
    })) : [];
  const resolvedDecisionUUIDs = Array.isArray(value.resolvedDecisionUUIDs)
    ? [...new Set(value.resolvedDecisionUUIDs.map(String))].slice(-512)
    : [];
  return Object.freeze({
    budgetSchemaVersion: 2,
    valueHorizon: 'current-session-verified-work-hours',
    safetyFraction,
    balanceImmediateWorkHours: finiteNumber(value.balanceImmediateWorkHours),
    cumulativeObservedImmediateWorkHours: Math.max(0, finiteNumber(
      value.cumulativeObservedImmediateWorkHours,
    )),
    cumulativeBaselineReferenceHours: Math.max(0, finiteNumber(
      value.cumulativeBaselineReferenceHours,
    )),
    resolvedDecisionCount: Math.max(0, Math.floor(finiteNumber(value.resolvedDecisionCount))),
    pending: Object.freeze(pending),
    resolvedDecisionUUIDs: Object.freeze(resolvedDecisionUUIDs),
  });
}

export function taskRecommenderV12AvailableBudgetHours(state = {}) {
  const normalized = normalizeTaskRecommenderV12BudgetState(state);
  const reserved = normalized.pending.reduce(
    (sum, entry) => sum + entry.reservedImmediateWorkHours,
    0,
  );
  return normalized.balanceImmediateWorkHours - reserved;
}

export function reserveTaskRecommenderV12Budget(state, decisionUUID, policyDecision = {}) {
  const normalized = normalizeTaskRecommenderV12BudgetState(state);
  const key = String(decisionUUID || '');
  if (!key || normalized.pending.some((entry) => entry.decisionUUID === key)
    || normalized.resolvedDecisionUUIDs.includes(key)) return normalized;
  return normalizeTaskRecommenderV12BudgetState({
    ...normalized,
    pending: [...normalized.pending, {
      decisionUUID: key,
      reservedImmediateWorkHours: Math.max(0, finiteNumber(
        policyDecision.safety?.reservedImmediateWorkHours,
      )),
      baselineReferenceHours: Math.max(0, finiteNumber(
        policyDecision.safety?.baselineReferenceHours,
      )),
    }],
  });
}

export function resolveTaskRecommenderV12Budget(
  state,
  decisionUUID,
  observedImmediateWorkSeconds = 0,
) {
  const normalized = normalizeTaskRecommenderV12BudgetState(state);
  const key = String(decisionUUID || '');
  if (!key || normalized.resolvedDecisionUUIDs.includes(key)) return normalized;
  const pending = normalized.pending.find((entry) => entry.decisionUUID === key);
  if (!pending) return normalized;
  const observedImmediateWorkHours = Math.max(
    0,
    finiteNumber(observedImmediateWorkSeconds),
  ) / 3600;
  const requiredHours = (1 - normalized.safetyFraction) * pending.baselineReferenceHours;
  return normalizeTaskRecommenderV12BudgetState({
    ...normalized,
    balanceImmediateWorkHours: normalized.balanceImmediateWorkHours
      + observedImmediateWorkHours - requiredHours,
    cumulativeObservedImmediateWorkHours: normalized.cumulativeObservedImmediateWorkHours
      + observedImmediateWorkHours,
    cumulativeBaselineReferenceHours: normalized.cumulativeBaselineReferenceHours
      + pending.baselineReferenceHours,
    resolvedDecisionCount: normalized.resolvedDecisionCount + 1,
    pending: normalized.pending.filter((entry) => entry.decisionUUID !== key),
    resolvedDecisionUUIDs: [...normalized.resolvedDecisionUUIDs, key],
  });
}

export function invalidateTaskRecommenderV12Budget(state, decisionUUID) {
  const normalized = normalizeTaskRecommenderV12BudgetState(state);
  const key = String(decisionUUID || '');
  if (!key) return normalized;
  return normalizeTaskRecommenderV12BudgetState({
    ...normalized,
    pending: normalized.pending.filter((entry) => entry.decisionUUID !== key),
    resolvedDecisionUUIDs: [...normalized.resolvedDecisionUUIDs, key],
  });
}

function selectFromDistribution(distribution, random) {
  let cursor = random();
  for (const entry of distribution) {
    cursor -= entry.behaviorProbability;
    if (cursor <= 0) return entry;
  }
  return distribution.at(-1) || null;
}

function compactHistogram(rows, keyName) {
  return rows
    .filter((row) => row.count > 0 || row.voteCount > 0)
    .map((row) => Object.freeze({
      [keyName]: row[keyName],
      votes: Math.max(0, Math.floor(finiteNumber(row.count ?? row.voteCount))),
    }));
}

export function buildTaskRecommenderV12PolicyDecision({
  model,
  recurrentState,
  actions = [],
  context = {},
  seed = 'task-recommender-v12-policy',
  budgetState = {},
  options = {},
} = {}) {
  if (!model?.posterior || !model?.safetyPosterior) {
    throw new TypeError('A v12 policy decision requires both value posteriors');
  }
  const posteriorUpdateCount = Math.max(
    0,
    Math.floor(finiteNumber(model.posterior.updateCount)),
  );
  const safetyPosteriorUpdateCount = Math.max(
    0,
    Math.floor(finiteNumber(model.safetyPosterior.updateCount)),
  );
  const minimumChampionEvidence = Math.max(1, Math.floor(finiteNumber(
    options.minimumChampionEvidence,
    TASK_RECOMMENDER_V12_DEFAULT_MINIMUM_CHAMPION_EVIDENCE,
  )));
  const posteriorEvidenceSufficient = posteriorUpdateCount >= minimumChampionEvidence;
  const safetyEvidenceSufficient = safetyPosteriorUpdateCount >= minimumChampionEvidence;
  const encodeAndPredict = (action) => {
    const encodedAction = action.encodedAction || encodeTaskRecommenderV12Action(action, context);
    const prediction = predictTaskRecommenderV12Action(model, recurrentState, encodedAction);
    return { ...action, encodedAction, ...prediction };
  };
  const coarseCandidates = sortedCandidates(actions).map(encodeAndPredict);
  const refinedActions = posteriorEvidenceSufficient && options.disableDurationRefinement !== true
    ? refineTaskRecommenderV12DurationSupport(coarseCandidates, options)
    : coarseCandidates;
  const encodedCandidates = refinedActions.map((action) => (
    Array.isArray(action.representation) ? action : encodeAndPredict(action)
  ));
  if (!encodedCandidates.length) return null;
  const champion = bestCandidate(
    encodedCandidates,
    (candidate) => candidate.mean,
    createSeededRandom(`${seed}:champion-tie`),
  );
  // The long-horizon champion remains the exploitation action. The proximal head
  // evaluates that same action so a zero-exploration mixture and its comparator match.
  const safetyBaseline = champion;
  const confidenceMultiplier = Math.max(0, finiteNumber(
    options.confidenceMultiplier,
    TASK_RECOMMENDER_V12_DEFAULT_CONFIDENCE_MULTIPLIER,
  ));
  const safetyBaselineLowerConfidenceHours = safetyBaseline.safetyMean
    - confidenceMultiplier * safetyBaseline.safetyEpistemicStdDev;
  const baselineEligible = options.baselineEligible !== false
    && posteriorEvidenceSufficient
    && safetyEvidenceSufficient
    && safetyBaselineLowerConfidenceHours > 0;
  const votes = sampleTaskRecommenderV12PosteriorVotes(model.posterior, encodedCandidates, {
    seed,
    sampleCount: options.posteriorSampleCount,
    posteriorSampler: options.posteriorSampler,
  });
  const hierarchical = buildTaskRecommenderV12HierarchicalSupport(votes.votes, options);
  const neutral = buildTaskRecommenderV12NeutralSupport(encodedCandidates);
  const explorationSupport = posteriorEvidenceSufficient ? hierarchical : neutral;
  const predictionByAction = new Map(encodedCandidates.map((candidate) => [
    candidate.actionKey,
    candidate,
  ]));
  const diagnosticBaselineReferenceHours = Math.max(0, safetyBaselineLowerConfidenceHours);
  const diagnosticExplorationConservativeImmediateWorkHours = explorationSupport.actions.reduce((sum, row) => {
    const candidate = predictionByAction.get(row.actionKey);
    const lowerValue = Math.max(
      0,
      candidate.safetyMean - confidenceMultiplier * candidate.safetyEpistemicStdDev,
    );
    return sum + row.explorationProbability * lowerValue;
  }, 0);
  const baselineReferenceHours = baselineEligible ? diagnosticBaselineReferenceHours : 0;
  const explorationConservativeImmediateWorkHours = baselineEligible
    ? diagnosticExplorationConservativeImmediateWorkHours
    : 0;
  const shortfallHours = Math.max(
    0,
    baselineReferenceHours - explorationConservativeImmediateWorkHours,
  );
  const normalizedBudget = normalizeTaskRecommenderV12BudgetState(budgetState);
  const availableBudgetHours = taskRecommenderV12AvailableBudgetHours(normalizedBudget);
  const safeCapacityHours = Math.max(
    0,
    availableBudgetHours + normalizedBudget.safetyFraction * baselineReferenceHours,
  );
  const maximumSafeExplorationMixture = baselineEligible && shortfallHours > 0
    ? clamp(safeCapacityHours / shortfallHours, 0, 1)
    : 1;
  const requestedExplorationMixture = clamp(finiteNumber(
    options.requestedExplorationMixture,
    1,
  ), 0, 1);
  const explorationMixture = baselineEligible
    ? Math.min(requestedExplorationMixture, maximumSafeExplorationMixture)
    : 1;
  const distribution = explorationSupport.actions.map((row) => Object.freeze({
    ...row,
    behaviorProbability: explorationMixture * row.explorationProbability
      + (row.actionKey === champion.actionKey ? 1 - explorationMixture : 0),
  }));
  const probabilityCorrection = 1 - distribution.reduce(
    (sum, row) => sum + row.behaviorProbability,
    0,
  );
  if (distribution.length && Math.abs(probabilityCorrection) > 0) {
    const last = distribution.at(-1);
    distribution[distribution.length - 1] = Object.freeze({
      ...last,
      behaviorProbability: last.behaviorProbability + probabilityCorrection,
    });
  }
  const selectionRandom = createSeededRandom(`${seed}:selection`);
  const selectedRow = selectFromDistribution(distribution, selectionRandom);
  const selected = predictionByAction.get(selectedRow.actionKey);
  const selectedTaskProbability = distribution
    .filter((row) => row.taskUUID === selectedRow.taskUUID)
    .reduce((sum, row) => sum + row.behaviorProbability, 0);
  const reservedImmediateWorkHours = Math.max(
    0,
    explorationMixture * shortfallHours
      - normalizedBudget.safetyFraction * baselineReferenceHours,
  );
  const posteriorFingerprint = taskRecommenderV12PosteriorFingerprint(model);
  const candidateSetFingerprint = fnv1a(encodedCandidates.map((candidate) => (
    `${candidate.actionKey}:${candidate.taskSnapshot?.contentHash || ''}`
  )).join('|'));
  const policyDecision = Object.freeze({
    policySchemaVersion: TASK_RECOMMENDER_V12_POLICY_SCHEMA_VERSION,
    policyVersion: TASK_RECOMMENDER_V12_POLICY_VERSION,
    evidence: Object.freeze({
      phase: baselineEligible
        ? 'supported'
        : posteriorEvidenceSufficient ? 'posterior-exploration' : 'neutral-exploration',
      baselineEligible,
      posteriorEvidenceSufficient,
      safetyEvidenceSufficient,
      posteriorUpdateCount,
      safetyPosteriorUpdateCount,
      minimumChampionEvidence,
      safetyBaselineLowerConfidenceHours,
    }),
    selected: Object.freeze({
      actionKey: selected.actionKey,
      taskUUID: String(selected.taskUUID),
      durationSeconds: Math.max(0, finiteNumber(selected.durationSeconds)),
      predictedLongHorizonWorkHours: finiteNumber(selected.mean),
      predictedImmediateWorkHours: Math.max(0, finiteNumber(selected.safetyMean)),
      immediateWorkEpistemicStdDevHours: Math.max(
        0,
        finiteNumber(selected.safetyEpistemicStdDev),
      ),
      jointBehaviorProbability: selectedRow.behaviorProbability,
      taskBehaviorProbability: selectedTaskProbability,
      durationConditionalBehaviorProbability: selectedTaskProbability > 0
        ? selectedRow.behaviorProbability / selectedTaskProbability
        : 0,
    }),
    champion: Object.freeze({
      actionKey: champion.actionKey,
      taskUUID: String(champion.taskUUID),
      durationSeconds: Math.max(0, finiteNumber(champion.durationSeconds)),
    }),
    safetyBaseline: Object.freeze({
      actionKey: safetyBaseline.actionKey,
      taskUUID: String(safetyBaseline.taskUUID),
      durationSeconds: Math.max(0, finiteNumber(safetyBaseline.durationSeconds)),
    }),
    posterior: Object.freeze({
      modelVersion: model.modelVersion,
      updateCount: Math.max(0, Math.floor(finiteNumber(model.posterior.updateCount))),
      fingerprint: posteriorFingerprint,
    }),
    rngRecipe: Object.freeze({
      algorithm: TASK_RECOMMENDER_V12_POLICY_RNG_ALGORITHM,
      seed: String(seed),
      posteriorStream: `${seed}:posterior`,
      selectionStream: `${seed}:selection`,
      championTieStream: `${seed}:champion-tie`,
      posteriorSampleCount: votes.sampleCount,
    }),
    support: Object.freeze({
      mode: posteriorEvidenceSufficient ? 'posterior-hierarchical' : 'neutral-hierarchical',
      construction: Object.freeze({
        type: 'log-quadrature-with-local-posterior-refinement',
        coarseActionCount: coarseCandidates.length,
        refinedActionCount: encodedCandidates.length - coarseCandidates.length,
        maxRefinementsPerTask: TASK_RECOMMENDER_V12_MAX_REFINEMENTS_PER_TASK,
      }),
      requestedTaskFloor: finiteNumber(
        options.taskSupportFloor,
        TASK_RECOMMENDER_V12_DEFAULT_TASK_SUPPORT_FLOOR,
      ),
      effectiveTaskFloor: posteriorEvidenceSufficient
        ? hierarchical.taskSupportFloor
        : 1 / Math.max(1, neutral.tasks.length),
      requestedDurationFloor: finiteNumber(
        options.durationSupportFloor,
        TASK_RECOMMENDER_V12_DEFAULT_DURATION_SUPPORT_FLOOR,
      ),
      effectiveDurationFloorForSelectedTask: posteriorEvidenceSufficient
        ? hierarchical.durationSupportFloorByTask[selected.taskUUID]
        : selectedRow.durationConditionalProbability,
    }),
    safety: Object.freeze({
      enabled: baselineEligible,
      reason: baselineEligible
        ? 'supported-immediate-baseline'
        : 'insufficient-immediate-baseline-evidence',
      head: 'proximal-immediate-work-bayesian-v1',
      valueHorizon: 'current-session-verified-work-hours',
      safetyFraction: normalizedBudget.safetyFraction,
      openingAvailableBudgetHours: availableBudgetHours,
      baselineReferenceHours,
      diagnosticBaselineReferenceHours,
      baselineMeanHours: safetyBaseline.safetyMean,
      baselineEpistemicStdDevHours: safetyBaseline.safetyEpistemicStdDev,
      explorationConservativeImmediateWorkHours,
      conservativeImmediateShortfallHours: shortfallHours,
      requestedExplorationMixture,
      maximumSafeExplorationMixture,
      appliedExplorationMixture: explorationMixture,
      reservedImmediateWorkHours,
    }),
    candidateCount: encodedCandidates.length,
    candidateSetFingerprint,
    voteHistogram: Object.freeze(compactHistogram(votes.votes, 'actionKey')),
    taskVoteHistogram: Object.freeze(compactHistogram(hierarchical.tasks, 'taskUUID')),
  });
  return {
    action: selected,
    policyDecision,
    distribution,
    candidateActions: encodedCandidates.map((candidate) => Object.freeze({
      actionKey: candidate.actionKey,
      taskUUID: String(candidate.taskUUID),
      durationSeconds: Math.max(0, finiteNumber(candidate.durationSeconds)),
      durationQuantumSeconds: Math.max(1, finiteNumber(candidate.durationQuantumSeconds, 60)),
      taskSnapshot: candidate.taskSnapshot,
    })),
  };
}

export function taskRecommenderV12PolicyDecisionPayload(policyDecision = {}) {
  const clone = JSON.parse(JSON.stringify(policyDecision));
  const joint = finiteNumber(clone?.selected?.jointBehaviorProbability, NaN);
  const task = finiteNumber(clone?.selected?.taskBehaviorProbability, NaN);
  const conditional = finiteNumber(
    clone?.selected?.durationConditionalBehaviorProbability,
    NaN,
  );
  if (![1, 2, 3, TASK_RECOMMENDER_V12_POLICY_SCHEMA_VERSION].includes(clone.policySchemaVersion)
    || !clone.selected?.actionKey
    || !Number.isFinite(joint) || joint <= 0 || joint > 1
    || !Number.isFinite(task) || task <= 0 || task > 1
    || !Number.isFinite(conditional) || conditional <= 0 || conditional > 1
    || Math.abs(joint - task * conditional) > 1e-10) {
    throw new TypeError('Invalid v12 policy decision payload');
  }
  return clone;
}
