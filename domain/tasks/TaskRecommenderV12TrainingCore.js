import {
  TASK_RECOMMENDER_EVENT_TYPES,
  TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION,
  compareTaskRecommenderProtocolEvents,
  isTaskRecommenderProtocolEvent,
  reduceTaskRecommenderDecision,
} from './TaskRecommenderProtocol.js';
import {
  TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
  TASK_RECOMMENDER_V12_ENCODER_VERSION,
  buildTaskRecommenderV12ActionSet,
  buildTaskRecommenderV12TaskExposure,
  encodeTaskRecommenderV12Action,
} from './TaskRecommenderV12Encoding.js';
import {
  createTaskRecommenderV12BayesianPosterior,
  encodeTaskRecommenderV12Event,
  predictTaskRecommenderV12Posterior,
  predictTaskRecommenderV12Action,
  replayTaskRecommenderV12Events,
  restoreTaskRecommenderV12Model,
  serializeTaskRecommenderV12Model,
  stepTaskRecommenderV12GRUWithCache,
  taskRecommenderV12RepresentationWithCache,
  updateTaskRecommenderV12Posterior,
} from './TaskRecommenderV12Model.js';
import { createSeededRandom, dense, tanh } from './TaskRecommenderV12Math.js';
import { buildTaskRecommenderV12PolicyDecision } from './TaskRecommenderV12Policy.js';
import {
  buildTaskRecommenderV12DecisionTransitions,
  computeTaskRecommenderV12RetraceTargets,
} from './TaskRecommenderV12Sequential.js';
import {
  buildTaskRecommenderV12RepresentationEvidence,
  normalizeTaskRecommenderV12RepresentationTrainingState,
  promoteTaskRecommenderV12RepresentationTrainingState,
  selectTaskRecommenderV12RepresentationPhase,
  trainTaskRecommenderV12ValueRepresentation,
} from './TaskRecommenderV12RepresentationTraining.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function buildTaskRecommenderV12ResolvedExamples(events = []) {
  const ordered = (events || [])
    .filter(isTaskRecommenderProtocolEvent)
    .sort(compareTaskRecommenderProtocolEvents);
  const byDecision = new Map();
  for (const event of ordered) {
    if (!byDecision.has(event.decisionUUID)) byDecision.set(event.decisionUUID, []);
    byDecision.get(event.decisionUUID).push(event);
  }
  const examples = [];
  for (const [decisionUUID, decisionEvents] of byDecision) {
    const created = decisionEvents.find((event) => (
      event.type === TASK_RECOMMENDER_EVENT_TYPES.decisionCreated
    ));
    if (!created?.payload?.taskSnapshot || !created.taskUUID) continue;
    const state = reduceTaskRecommenderDecision(decisionEvents, decisionUUID);
    if (!['skipped', 'session-finished', 'completed'].includes(state.status)) continue;
    const decisionCreatedMs = new Date(created.occurredAt).getTime();
    const rewardAtoms = decisionEvents
      .filter((event) => event.type === TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished)
      .map((event) => {
        const productiveSeconds = Math.max(0, Number(event.payload?.productiveSeconds) || 0);
        const occurredAt = event.payload?.sessionFinishedAt || event.occurredAt;
        const occurredAtMs = new Date(occurredAt).getTime();
        const sessionStartedAtMs = new Date(event.payload?.sessionStartedAt).getTime();
        const hasVerifiedTimingSchema = Number(event.payload?.sessionTimingSchemaVersion)
          === TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION;
        return Object.freeze({
          rewardAtomSchemaVersion: 1,
          eventUUID: String(event.UUID),
          occurredAt,
          productiveSeconds,
          rewardHours: productiveSeconds / 3600,
          timingVerified: hasVerifiedTimingSchema
            && Number.isFinite(occurredAtMs)
            && Number.isFinite(sessionStartedAtMs)
            && sessionStartedAtMs >= decisionCreatedMs
            && occurredAtMs >= sessionStartedAtMs,
        });
      });
    const atomProductiveSeconds = rewardAtoms.reduce(
      (sum, atom) => sum + atom.productiveSeconds,
      0,
    );
    const rewardTimingVerified = state.productiveSeconds === 0 || (
      rewardAtoms.length > 0
      && rewardAtoms.every((atom) => atom.timingVerified)
      && Math.abs(atomProductiveSeconds - state.productiveSeconds) < 1e-9
    );
    examples.push(Object.freeze({
      decisionUUID,
      playerUUID: created.parent,
      taskUUID: created.taskUUID,
      source: created.source || 'tasks',
      occurredAt: created.occurredAt,
      resolvedAt: state.completedAt || state.sessionFinishedAt || state.skippedAt,
      observationSessionUUID: created.payload?.observationSessionUUID == null
        ? null
        : String(created.payload.observationSessionUUID),
      decisionSequence: Number(created.sequence || 0),
      actionKey: created.payload.actionKey == null ? null : String(created.payload.actionKey),
      taskSnapshot: created.payload.taskSnapshot,
      candidateManifest: created.payload.candidateManifest || null,
      policyDecision: created.payload.policyDecision || null,
      proposedDurationSeconds: Math.max(0, Number(created.payload.proposedDurationSeconds) || 0),
      behaviorProbability: Number.isFinite(Number(created.payload.behaviorProbability))
        && Number(created.payload.behaviorProbability) > 0
        && Number(created.payload.behaviorProbability) <= 1
        ? Number(created.payload.behaviorProbability)
        : null,
      targetProbability: Number.isFinite(Number(created.payload.targetProbability))
        && Number(created.payload.targetProbability) >= 0
        && Number(created.payload.targetProbability) <= 1
        ? Number(created.payload.targetProbability)
        : null,
      productiveSeconds: Math.max(0, state.productiveSeconds),
      targetWorkHours: Math.max(0, state.productiveSeconds) / 3600,
      rewardAtoms: Object.freeze(rewardAtoms),
      rewardTimingVerified,
      terminalStatus: state.status,
    }));
  }
  return examples.sort((left, right) => (
    left.decisionSequence - right.decisionSequence
    || left.occurredAt.localeCompare(right.occurredAt)
    || left.decisionUUID.localeCompare(right.decisionUUID)
  ));
}

export function buildTaskRecommenderV12ReplayIndex(examples = [], options = {}) {
  const maximum = Math.max(1, Math.floor(Number(options.maxEntries) || 5_000));
  const recentFraction = clamp(Number(options.recentFraction) || 0.7, 0, 1);
  const ordered = [...examples].sort((left, right) => (
    left.decisionSequence - right.decisionSequence
    || left.decisionUUID.localeCompare(right.decisionUUID)
  ));
  if (ordered.length <= maximum) return ordered.map((entry) => Object.freeze({ ...entry }));
  const recentCount = Math.min(maximum, Math.max(1, Math.round(maximum * recentFraction)));
  const recent = ordered.slice(-recentCount);
  const older = ordered.slice(0, -recentCount);
  const remaining = maximum - recent.length;
  const random = createSeededRandom(options.seed || 'v12-replay');
  const reservoir = [];
  older.forEach((entry, index) => {
    if (reservoir.length < remaining) reservoir.push(entry);
    else {
      const replacement = Math.floor(random() * (index + 1));
      if (replacement < remaining) reservoir[replacement] = entry;
    }
  });
  return [...reservoir, ...recent]
    .sort((left, right) => left.decisionSequence - right.decisionSequence)
    .map((entry) => Object.freeze({ ...entry }));
}

function actionForExample(example, events = []) {
  const task = { ...example.taskSnapshot, UUID: example.taskUUID };
  const action = buildTaskRecommenderV12ActionSet([task], {
    minDurationSeconds: Math.max(1, example.proposedDurationSeconds),
    maxDurationSeconds: Math.max(1, example.proposedDurationSeconds),
    durationPointCount: 3,
    durationQuantumSeconds: 1,
  })[0];
  if (!action) return null;
  return encodeTaskRecommenderV12Action(action, {
    now: example.occurredAt,
    source: example.source,
    queueSize: Math.max(1, Number(example.candidateManifest?.taskCount) || 1),
    taskExposureByUUID: buildTaskRecommenderV12TaskExposure(events, example.occurredAt),
  });
}

function historyBefore(events, sequence) {
  return events.filter((event) => Number(event.sequence || 0) < sequence);
}

function exactCandidateActions(example, snapshotsByUUID = {}) {
  const manifest = example.candidateManifest;
  if (Number(manifest?.candidateManifestVersion) !== 1) {
    return { actions: null, reason: 'unsupported-candidate-manifest' };
  }
  if (Number(manifest.actionSchemaVersion) !== TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION
    || Number(manifest.encoderVersion) !== TASK_RECOMMENDER_V12_ENCODER_VERSION) {
    return { actions: null, reason: 'unsupported-action-or-encoder-version' };
  }
  if (!Array.isArray(manifest.actions) || !manifest.actions.length) {
    return { actions: null, reason: 'missing-candidate-actions' };
  }
  const actions = [];
  for (const recorded of manifest.actions) {
    const snapshot = snapshotsByUUID?.[recorded.snapshotUUID];
    if (!snapshot
      || String(snapshot.UUID) !== String(recorded.taskUUID)
      || String(snapshot.contentHash) !== String(recorded.contentHash)) {
      return { actions: null, reason: 'missing-or-mismatched-candidate-snapshot' };
    }
    if (Number(recorded.actionSchemaVersion) !== TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION) {
      return { actions: null, reason: 'unsupported-candidate-action-version' };
    }
    actions.push({
      actionKey: String(recorded.actionKey),
      taskUUID: String(recorded.taskUUID),
      durationSeconds: Math.max(0, Number(recorded.durationSeconds) || 0),
      durationQuantumSeconds: Math.max(1, Number(recorded.durationQuantumSeconds) || 60),
      taskSnapshot: snapshot,
    });
  }
  return { actions, reason: null };
}

export function reconstructTaskRecommenderV12TargetProbability(
  targetModel,
  events,
  example,
  options = {},
) {
  const actionKey = String(example.actionKey || '');
  const recipe = example.policyDecision;
  if (!actionKey || !recipe?.rngRecipe?.seed) {
    return { probability: null, reason: 'missing-selected-action-or-policy-recipe' };
  }
  const exact = exactCandidateActions(example, options.candidateSnapshotsByUUID);
  if (!exact.actions) return { probability: null, reason: exact.reason };
  if (!exact.actions.some((action) => action.actionKey === actionKey)) {
    return { probability: null, reason: 'selected-action-not-in-candidate-manifest' };
  }
  const priorEvents = historyBefore(events, example.decisionSequence);
  const recurrentState = replayTaskRecommenderV12Events(targetModel, priorEvents);
  const context = {
    now: example.candidateManifest.occurredAt || example.occurredAt,
    source: example.candidateManifest.source || example.source,
    queueSize: Math.max(1, Number(example.candidateManifest.taskCount) || 1),
    taskExposureByUUID: buildTaskRecommenderV12TaskExposure(
      priorEvents,
      example.candidateManifest.occurredAt || example.occurredAt,
    ),
  };
  const openingAvailableBudgetHours = Number(recipe.safety?.openingAvailableBudgetHours);
  const evaluated = buildTaskRecommenderV12PolicyDecision({
    model: targetModel,
    recurrentState,
    actions: exact.actions,
    context,
    seed: String(recipe.rngRecipe.seed),
    budgetState: {
      balanceImmediateWorkHours: Number.isFinite(openingAvailableBudgetHours)
        ? openingAvailableBudgetHours
        : 0,
      safetyFraction: recipe.safety?.safetyFraction,
    },
    options: {
      disableDurationRefinement: true,
      posteriorSampleCount: recipe.rngRecipe.posteriorSampleCount,
      minimumChampionEvidence: recipe.evidence?.minimumChampionEvidence,
      taskSupportFloor: recipe.support?.requestedTaskFloor,
      durationSupportFloor: recipe.support?.requestedDurationFloor,
      requestedExplorationMixture: recipe.safety?.requestedExplorationMixture,
    },
  });
  const row = evaluated?.distribution?.find((entry) => entry.actionKey === actionKey);
  const reconstructed = Number(row?.behaviorProbability);
  if (!Number.isFinite(reconstructed) || reconstructed < 0 || reconstructed > 1) {
    return { probability: null, reason: 'target-policy-action-probability-unavailable' };
  }
  return {
    probability: reconstructed,
    reason: null,
    targetPolicyVersion: evaluated.policyDecision.policyVersion,
  };
}

export function materializeTaskRecommenderV12Example(model, events, example) {
  const encodedAction = actionForExample(example, events);
  if (!encodedAction) return null;
  const recurrentState = replayTaskRecommenderV12Events(
    model,
    historyBefore(events, example.decisionSequence),
  );
  const prediction = predictTaskRecommenderV12Action(model, recurrentState, encodedAction);
  return { ...example, encodedAction, recurrentState, ...prediction };
}

function materializeTaskRecommenderV12ValueSample(
  model,
  events,
  example,
  longTarget,
) {
  const encodedAction = actionForExample(example, events);
  if (!encodedAction) return null;
  const history = historyBefore(events, example.decisionSequence);
  let recurrentState = Array(model.dimensions.state).fill(0);
  let recurrentCache = null;
  if (history.length) {
    const finalEvent = history.at(-1);
    const preceding = history.slice(0, -1);
    recurrentState = replayTaskRecommenderV12Events(model, preceding);
    const input = encodeTaskRecommenderV12Event(
      finalEvent,
      preceding.at(-1)?.occurredAt || null,
    );
    const stepped = stepTaskRecommenderV12GRUWithCache(
      model.gru,
      input,
      recurrentState,
    );
    recurrentState = stepped.state;
    recurrentCache = stepped.cache;
  }
  const materialized = taskRecommenderV12RepresentationWithCache(
    model,
    recurrentState,
    encodedAction,
  );
  const longPrediction = predictTaskRecommenderV12Posterior(
    model.posterior,
    materialized.representation,
  );
  const safetyPrediction = predictTaskRecommenderV12Posterior(
    model.safetyPosterior,
    materialized.representation,
  );
  return {
    representation: materialized.representation,
    cache: materialized.cache,
    recurrentCache,
    longPrediction: longPrediction.mean,
    safetyPrediction: safetyPrediction.mean,
    longTarget,
    safetyTarget: example.targetWorkHours,
  };
}

function updateLayer(layer, input, delta, learningRate) {
  for (let output = 0; output < layer.outputWidth; output += 1) {
    const gradient = clamp(delta[output], -1, 1);
    layer.bias[output] -= learningRate * gradient;
    const offset = output * layer.inputWidth;
    for (let index = 0; index < layer.inputWidth; index += 1) {
      layer.weights[offset + index] -= learningRate * gradient * input[index];
    }
  }
}

function inputGradient(weights, delta, inputWidth, outputWidth) {
  const result = Array(inputWidth).fill(0);
  for (let output = 0; output < outputWidth; output += 1) {
    const offset = output * inputWidth;
    for (let index = 0; index < inputWidth; index += 1) {
      result[index] += weights[offset + index] * delta[output];
    }
  }
  return result;
}

function updateGRUGate(inputWeights, stateWeights, bias, input, state, delta, learningRate) {
  const width = delta.length;
  for (let output = 0; output < width; output += 1) {
    const gradient = clamp(delta[output], -1, 1);
    bias[output] -= learningRate * gradient;
    for (let index = 0; index < input.length; index += 1) {
      inputWeights[output * input.length + index] -= learningRate * gradient * input[index];
    }
    for (let index = 0; index < state.length; index += 1) {
      stateWeights[output * state.length + index] -= learningRate * gradient * state[index];
    }
  }
}

function trainWorldPair(
  model,
  input,
  nextInput,
  previousState,
  learningRate,
  trainSharedEncoder = true,
) {
  const { state, cache } = stepTaskRecommenderV12GRUWithCache(model.gru, input, previousState);
  const worldWeights = [...model.worldLayer.weights];
  const prediction = dense(
    state,
    model.worldLayer.weights,
    model.worldLayer.bias,
    model.worldLayer.outputWidth,
  );
  const outputDelta = prediction.map((value, index) => (
    clamp(value - nextInput[index], -2, 2) / prediction.length
  ));
  const stateDelta = inputGradient(
    worldWeights,
    outputDelta,
    model.worldLayer.inputWidth,
    model.worldLayer.outputWidth,
  );
  updateLayer(model.worldLayer, state, outputDelta, learningRate);

  const candidateDelta = stateDelta.map((value, index) => value * cache.update[index]);
  const updateDelta = stateDelta.map((value, index) => (
    value * (cache.candidate[index] - cache.previousState[index])
  ));
  const candidatePreDelta = candidateDelta.map((value, index) => (
    value * (1 - cache.candidate[index] ** 2)
  ));
  const resetStateDelta = inputGradient(
    model.gru.stateCandidate,
    candidatePreDelta,
    model.gru.hiddenWidth,
    model.gru.hiddenWidth,
  );
  const resetDelta = resetStateDelta.map((value, index) => value * cache.previousState[index]);
  const resetPreDelta = resetDelta.map((value, index) => (
    value * cache.reset[index] * (1 - cache.reset[index])
  ));
  const updatePreDelta = updateDelta.map((value, index) => (
    value * cache.update[index] * (1 - cache.update[index])
  ));

  if (trainSharedEncoder) {
    updateGRUGate(
      model.gru.inputCandidate,
      model.gru.stateCandidate,
      model.gru.candidateBias,
      cache.input,
      cache.resetState,
      candidatePreDelta,
      learningRate,
    );
    updateGRUGate(
      model.gru.inputReset,
      model.gru.stateReset,
      model.gru.resetBias,
      cache.input,
      cache.previousState,
      resetPreDelta,
      learningRate,
    );
    updateGRUGate(
      model.gru.inputUpdate,
      model.gru.stateUpdate,
      model.gru.updateBias,
      cache.input,
      cache.previousState,
      updatePreDelta,
      learningRate,
    );
  }
  const loss = prediction.reduce((sum, value, index) => sum + (value - nextInput[index]) ** 2, 0)
    / prediction.length;
  return { state, loss };
}

export function trainTaskRecommenderV12EventAuxiliary(model, events = [], options = {}) {
  const ordered = [...events].filter(isTaskRecommenderProtocolEvent).sort(compareTaskRecommenderProtocolEvents);
  const maximum = Math.min(ordered.length - 1, Math.max(0, Math.floor(Number(options.maxSteps) || 256)));
  const learningRate = clamp(Number(options.learningRate) || 0.001, 1e-6, 0.02);
  let state = Array(model.dimensions.state).fill(0);
  let previousAt = null;
  let loss = 0;
  for (let index = 0; index < maximum; index += 1) {
    const input = encodeTaskRecommenderV12Event(ordered[index], previousAt);
    const nextInput = encodeTaskRecommenderV12Event(ordered[index + 1], ordered[index].occurredAt);
    const result = trainWorldPair(
      model,
      input,
      nextInput,
      state,
      learningRate,
      options.trainRecurrentEncoder !== false,
    );
    state = result.state;
    loss += result.loss;
    previousAt = ordered[index].occurredAt;
  }
  return { steps: maximum, meanLoss: maximum ? loss / maximum : 0 };
}

export function trainTaskRecommenderV12TaskAuxiliary(model, encodedActions = [], options = {}) {
  const maximum = Math.min(encodedActions.length, Math.max(0, Math.floor(Number(options.maxSteps) || 256)));
  const learningRate = clamp(Number(options.learningRate) || 0.001, 1e-6, 0.02);
  let loss = 0;
  for (let step = 0; step < maximum; step += 1) {
    const input = [
      ...encodedActions[step].numeric,
      ...encodedActions[step].text,
      ...encodedActions[step].categorical,
    ];
    const taskState = dense(
      input,
      model.taskLayer.weights,
      model.taskLayer.bias,
      model.taskLayer.outputWidth,
      tanh,
    );
    const reconstructionWeights = [...model.taskReconstructionLayer.weights];
    const prediction = dense(
      taskState,
      model.taskReconstructionLayer.weights,
      model.taskReconstructionLayer.bias,
      model.taskReconstructionLayer.outputWidth,
    );
    const outputDelta = prediction.map((value, index) => (
      clamp(value - input[index], -2, 2) / prediction.length
    ));
    const taskDelta = inputGradient(
      reconstructionWeights,
      outputDelta,
      model.taskReconstructionLayer.inputWidth,
      model.taskReconstructionLayer.outputWidth,
    ).map((value, index) => value * (1 - taskState[index] ** 2));
    updateLayer(model.taskReconstructionLayer, taskState, outputDelta, learningRate);
    if (options.trainTaskEncoder !== false) {
      updateLayer(model.taskLayer, input, taskDelta, learningRate);
    }
    loss += prediction.reduce((sum, value, index) => sum + (value - input[index]) ** 2, 0)
      / prediction.length;
  }
  return { steps: maximum, meanLoss: maximum ? loss / maximum : 0 };
}

function evaluateExamples(model, events, examples, targets = null) {
  let squaredError = 0;
  let count = 0;
  for (const example of examples) {
    const materialized = materializeTaskRecommenderV12Example(model, events, example);
    if (!materialized) continue;
    const target = targets?.get(example.decisionUUID) ?? example.targetWorkHours;
    squaredError += (materialized.mean - target) ** 2;
    count += 1;
  }
  return { count, meanSquaredError: count ? squaredError / count : 0 };
}

function evaluateSafetyExamples(model, events, examples) {
  let squaredError = 0;
  let absoluteCalibrationError = 0;
  let predictedHours = 0;
  let observedHours = 0;
  let count = 0;
  for (const example of examples) {
    const materialized = materializeTaskRecommenderV12Example(model, events, example);
    if (!materialized) continue;
    const observed = example.targetWorkHours;
    const error = materialized.safetyMean - observed;
    squaredError += error ** 2;
    absoluteCalibrationError += Math.abs(error);
    predictedHours += materialized.safetyMean;
    observedHours += observed;
    count += 1;
  }
  return {
    count,
    meanSquaredError: count ? squaredError / count : 0,
    meanAbsoluteCalibrationError: count ? absoluteCalibrationError / count : 0,
    meanPredictedImmediateWorkHours: count ? predictedHours / count : 0,
    meanObservedImmediateWorkHours: count ? observedHours / count : 0,
  };
}

function fitPosterior(model, events, examples, targets = null) {
  model.posterior = createTaskRecommenderV12BayesianPosterior({
    width: model.dimensions.representation,
    priorPrecision: model.posterior.priorPrecision,
    observationVariance: model.posterior.observationVariance,
  });
  let trained = 0;
  for (const example of examples) {
    const materialized = materializeTaskRecommenderV12Example(model, events, example);
    if (!materialized) continue;
    updateTaskRecommenderV12Posterior(
      model.posterior,
      materialized.representation,
      targets?.get(example.decisionUUID) ?? example.targetWorkHours,
    );
    trained += 1;
  }
  return trained;
}

function fitSafetyPosterior(model, events, examples) {
  model.safetyPosterior = createTaskRecommenderV12BayesianPosterior({
    width: model.dimensions.representation,
    priorPrecision: model.safetyPosterior.priorPrecision,
    observationVariance: model.safetyPosterior.observationVariance,
  });
  let trained = 0;
  for (const example of examples) {
    const materialized = materializeTaskRecommenderV12Example(model, events, example);
    if (!materialized) continue;
    updateTaskRecommenderV12Posterior(
      model.safetyPosterior,
      materialized.representation,
      example.targetWorkHours,
    );
    trained += 1;
  }
  return trained;
}

export function buildTaskRecommenderV12SequentialTargets(
  targetModel,
  events,
  examples,
  options = {},
) {
  const steps = [];
  const reconstruction = {
    exact: 0,
    overrides: 0,
    unsupported: 0,
    unsupportedReasons: {},
  };
  for (const example of examples) {
    const materialized = materializeTaskRecommenderV12Example(targetModel, events, example);
    if (!materialized) continue;
    const overriddenTargetProbability = options.targetProbabilityByDecision?.[example.decisionUUID];
    let targetProbability = null;
    if (Number.isFinite(Number(overriddenTargetProbability))) {
      targetProbability = Number(overriddenTargetProbability);
      reconstruction.overrides += 1;
    } else {
      const result = reconstructTaskRecommenderV12TargetProbability(
        targetModel,
        events,
        example,
        options,
      );
      targetProbability = result.probability;
      if (targetProbability == null) {
        reconstruction.unsupported += 1;
        reconstruction.unsupportedReasons[result.reason] = (
          reconstruction.unsupportedReasons[result.reason] || 0
        ) + 1;
      } else {
        reconstruction.exact += 1;
      }
    }
    steps.push({
      decisionUUID: example.decisionUUID,
      decisionSequence: example.decisionSequence,
      occurredAt: example.occurredAt,
      rewardHours: example.targetWorkHours,
      rewardAtoms: example.rewardAtoms,
      rewardTimingVerified: example.rewardTimingVerified,
      observationSessionUUID: example.observationSessionUUID,
      qValue: materialized.mean,
      behaviorProbability: example.behaviorProbability,
      targetProbability,
    });
  }
  const observationEndAt = events.reduce((latest, event) => {
    const occurredAtMs = new Date(event?.occurredAt).getTime();
    return Number.isFinite(occurredAtMs) && occurredAtMs > latest.milliseconds
      ? { milliseconds: occurredAtMs, value: event.occurredAt }
      : latest;
  }, { milliseconds: 0, value: null }).value;
  const transitions = buildTaskRecommenderV12DecisionTransitions(steps, {
    halfLifeMs: options.halfLifeMs,
    observationEndAt,
    finalBootstrapValue: steps.at(-1)?.qValue,
  });
  const result = computeTaskRecommenderV12RetraceTargets(transitions, options);
  const ratioDifferentFromOne = transitions.filter((transition) => (
    transition.propensityUsable && Math.abs(transition.importanceRatio - 1) > 1e-12
  )).length;
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      targetPolicyReconstruction: {
        ...reconstruction,
        ratioDifferentFromOne,
      },
    },
    targetByDecision: new Map(result.targets.map((entry) => [
      entry.decisionUUID,
      entry.targetWorkHours,
    ])),
  };
}

export function trainTaskRecommenderV12Candidate(currentModel, events = [], options = {}) {
  const orderedEvents = [...events]
    .filter(isTaskRecommenderProtocolEvent)
    .sort(compareTaskRecommenderProtocolEvents);
  const allExamples = buildTaskRecommenderV12ResolvedExamples(orderedEvents);
  const replay = buildTaskRecommenderV12ReplayIndex(allExamples, options);
  const validationCount = replay.length >= 8 ? Math.max(1, Math.floor(replay.length * 0.2)) : 0;
  const trainingExamples = validationCount ? replay.slice(0, -validationCount) : replay;
  const validationExamples = validationCount ? replay.slice(-validationCount) : [];
  const targetModel = options.targetModel
    ? restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(options.targetModel))
    : currentModel;
  const sequential = buildTaskRecommenderV12SequentialTargets(
    targetModel,
    orderedEvents,
    replay,
    options,
  );
  const representationEvidence = buildTaskRecommenderV12RepresentationEvidence(
    allExamples,
    sequential.diagnostics,
  );
  const representationSelection = selectTaskRecommenderV12RepresentationPhase(
    options.representationTrainingState,
    representationEvidence,
    options,
  );
  const baseline = evaluateExamples(
    currentModel,
    orderedEvents,
    validationExamples,
    sequential.targetByDecision,
  );
  const safetyBaseline = evaluateSafetyExamples(
    currentModel,
    orderedEvents,
    validationExamples,
  );
  const candidate = restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(currentModel));
  const referenceModel = restoreTaskRecommenderV12Model(
    serializeTaskRecommenderV12Model(currentModel),
  );
  const eventAuxiliary = trainTaskRecommenderV12EventAuxiliary(candidate, orderedEvents, {
    ...options,
    trainRecurrentEncoder:
      representationSelection.trainableLayerMask.recurrentEncoderAuxiliary,
  });
  const encodedActions = trainingExamples.map((example) => actionForExample(
    example,
    orderedEvents,
  )).filter(Boolean);
  const taskAuxiliary = trainTaskRecommenderV12TaskAuxiliary(candidate, encodedActions, {
    ...options,
    trainTaskEncoder: representationSelection.trainableLayerMask.taskEncoderAuxiliary,
  });
  fitPosterior(candidate, orderedEvents, trainingExamples, sequential.targetByDecision);
  fitSafetyPosterior(candidate, orderedEvents, trainingExamples);
  const valueRepresentation = trainTaskRecommenderV12ValueRepresentation(
    candidate,
    referenceModel,
    trainingExamples,
    (example) => materializeTaskRecommenderV12ValueSample(
      candidate,
      orderedEvents,
      example,
      sequential.targetByDecision.get(example.decisionUUID) ?? example.targetWorkHours,
    ),
    representationSelection,
    options,
  );
  if (valueRepresentation.metrics.steps) {
    fitPosterior(candidate, orderedEvents, trainingExamples, sequential.targetByDecision);
    fitSafetyPosterior(candidate, orderedEvents, trainingExamples);
  }
  const validation = evaluateExamples(
    candidate,
    orderedEvents,
    validationExamples,
    sequential.targetByDecision,
  );
  const safetyValidation = evaluateSafetyExamples(candidate, orderedEvents, validationExamples);
  const valueEligible = !validation.count
    || validation.meanSquaredError <= baseline.meanSquaredError
      + Math.max(1e-9, Number(options.promotionTolerance) || 0.01);
  const safetyEligible = !safetyValidation.count
    || safetyValidation.meanSquaredError <= safetyBaseline.meanSquaredError
      + Math.max(1e-9, Number(options.safetyPromotionTolerance) || 0.01);
  let numericallyValid = true;
  try {
    restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(candidate));
  } catch {
    numericallyValid = false;
  }
  const promotionEligible = valueEligible && safetyEligible && numericallyValid;
  const representationTrainingState = promotionEligible
    ? promoteTaskRecommenderV12RepresentationTrainingState(
      representationSelection,
      valueRepresentation,
      targetModel,
    )
    : normalizeTaskRecommenderV12RepresentationTrainingState(
      representationSelection.previousState,
    );
  if (promotionEligible) {
    fitPosterior(candidate, orderedEvents, replay, sequential.targetByDecision);
    fitSafetyPosterior(candidate, orderedEvents, replay);
  }
  return {
    model: promotionEligible ? candidate : currentModel,
    promoted: promotionEligible,
    replaySize: replay.length,
    resolvedExamples: allExamples.length,
    trainedExamples: promotionEligible ? replay.length : trainingExamples.length,
    trainedThroughSequence: replay.at(-1)?.decisionSequence || 0,
    metrics: {
      baseline,
      validation,
      safetyCalibration: {
        baseline: safetyBaseline,
        validation: safetyValidation,
        promotionEligible: safetyEligible,
        valueHorizon: 'current-session-verified-work-hours',
      },
      representationTraining: {
        ...valueRepresentation.metrics,
        previousPhase: representationSelection.previousState.phase,
        attemptedPhase: representationSelection.attemptPhase,
        phaseAdvanced: representationSelection.phaseAdvanced,
        promotedPhase: representationTrainingState.phase,
        rolledBack: !promotionEligible,
        numericallyValid,
        evidence: representationSelection.evidence,
        gates: representationSelection.gates,
        optimizerStep: representationTrainingState.optimizerState.step,
        targetCopy: representationTrainingState.targetCopy,
      },
      eventAuxiliary,
      taskAuxiliary,
      delayedCredit: sequential.diagnostics,
    },
    representationTrainingState,
  };
}
