export const TASK_RECOMMENDER_V12_REPRESENTATION_TRAINING_SCHEMA_VERSION = 1;
export const TASK_RECOMMENDER_V12_REPRESENTATION_OPTIMIZER = 'adam-trust-region-v1';

export const TASK_RECOMMENDER_V12_REPRESENTATION_PHASES = Object.freeze([
  'head-only',
  'representation',
  'interaction',
  'recurrent',
]);

export const TASK_RECOMMENDER_V12_REPRESENTATION_PHASE_THRESHOLDS = Object.freeze({
  representation: Object.freeze({
    resolvedDecisions: 32,
    activeDays: 3,
    returnCycles: 2,
    exactPropensityCoverage: 0.25,
  }),
  interaction: Object.freeze({
    resolvedDecisions: 96,
    activeDays: 7,
    returnCycles: 4,
    exactPropensityCoverage: 0.5,
  }),
  recurrent: Object.freeze({
    resolvedDecisions: 256,
    activeDays: 14,
    returnCycles: 8,
    exactPropensityCoverage: 0.75,
  }),
});

export const TASK_RECOMMENDER_V12_REPRESENTATION_TRUST_RADII = Object.freeze({
  representationLayer: 0.05,
  interactionLayer: 0.04,
  taskLayer: 0.02,
  gru: 0.02,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

function phaseIndex(phase) {
  const index = TASK_RECOMMENDER_V12_REPRESENTATION_PHASES.indexOf(String(phase));
  return index < 0 ? 0 : index;
}

export function taskRecommenderV12TrainableLayerMask(phase = 'head-only') {
  const index = phaseIndex(phase);
  return Object.freeze({
    representationLayer: index >= 1,
    interactionLayer: index >= 2,
    recurrentValue: index >= 3,
    taskEncoderAuxiliary: index >= 2,
    recurrentEncoderAuxiliary: index >= 3,
  });
}

function validMoment(moment = {}) {
  return Array.isArray(moment.m)
    && Array.isArray(moment.v)
    && moment.m.length === moment.v.length
    && moment.m.every(Number.isFinite)
    && moment.v.every((value) => Number.isFinite(value) && value >= 0);
}

function normalizeOptimizerState(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const moments = {};
  if (value.algorithm === TASK_RECOMMENDER_V12_REPRESENTATION_OPTIMIZER) {
    for (const [key, moment] of Object.entries(value.moments || {})) {
      if (validMoment(moment)) {
        moments[key] = { m: [...moment.m], v: [...moment.v] };
      }
    }
  }
  return {
    algorithm: TASK_RECOMMENDER_V12_REPRESENTATION_OPTIMIZER,
    step: Math.max(0, Math.floor(finite(value.step))),
    moments,
  };
}

export function normalizeTaskRecommenderV12RepresentationTrainingState(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const phase = TASK_RECOMMENDER_V12_REPRESENTATION_PHASES.includes(value.phase)
    ? value.phase
    : 'head-only';
  return Object.freeze({
    representationTrainingSchemaVersion:
      TASK_RECOMMENDER_V12_REPRESENTATION_TRAINING_SCHEMA_VERSION,
    phase,
    trainableLayerMask: taskRecommenderV12TrainableLayerMask(phase),
    optimizerState: normalizeOptimizerState(value.optimizerState),
    phasePromotionCount: Math.max(0, Math.floor(finite(value.phasePromotionCount))),
    successfulValueSteps: Math.max(0, Math.floor(finite(value.successfulValueSteps))),
    lastEvidence: value.lastEvidence ? Object.freeze({ ...value.lastEvidence }) : null,
    targetCopy: value.targetCopy ? Object.freeze({ ...value.targetCopy }) : null,
  });
}

function calendarDay(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

export function buildTaskRecommenderV12RepresentationEvidence(
  examples = [],
  sequentialDiagnostics = {},
) {
  const activeDays = new Set();
  const observationSessions = new Set();
  for (const example of examples) {
    const day = calendarDay(example.resolvedAt || example.occurredAt);
    if (day) activeDays.add(day);
    if (example.observationSessionUUID) {
      observationSessions.add(String(example.observationSessionUUID));
    }
  }
  const reconstruction = sequentialDiagnostics.targetPolicyReconstruction || {};
  const supported = Math.max(0, finite(reconstruction.exact));
  const unsupported = Math.max(0, finite(reconstruction.unsupported));
  const total = supported + unsupported;
  return Object.freeze({
    resolvedDecisions: examples.length,
    activeDays: activeDays.size,
    returnCycles: Math.max(
      0,
      observationSessions.size - 1,
      Math.floor(finite(sequentialDiagnostics.observedReturnBoundaries)),
    ),
    exactPropensityCoverage: total > 0 ? supported / total : 0,
  });
}

function thresholdFor(phase, options = {}) {
  const defaults = TASK_RECOMMENDER_V12_REPRESENTATION_PHASE_THRESHOLDS[phase];
  const overrides = options.representationPhaseThresholds?.[phase] || {};
  return Object.freeze({
    resolvedDecisions: Math.max(0, Math.floor(finite(
      overrides.resolvedDecisions,
      defaults.resolvedDecisions,
    ))),
    activeDays: Math.max(0, Math.floor(finite(overrides.activeDays, defaults.activeDays))),
    returnCycles: Math.max(0, Math.floor(finite(
      overrides.returnCycles,
      defaults.returnCycles,
    ))),
    exactPropensityCoverage: clamp(finite(
      overrides.exactPropensityCoverage,
      defaults.exactPropensityCoverage,
    ), 0, 1),
  });
}

function meetsThreshold(evidence, threshold) {
  return evidence.resolvedDecisions >= threshold.resolvedDecisions
    && evidence.activeDays >= threshold.activeDays
    && evidence.returnCycles >= threshold.returnCycles
    && evidence.exactPropensityCoverage >= threshold.exactPropensityCoverage;
}

export function selectTaskRecommenderV12RepresentationPhase(
  previousValue,
  evidence,
  options = {},
) {
  const previousState = normalizeTaskRecommenderV12RepresentationTrainingState(previousValue);
  const gates = {};
  let maximumEligibleIndex = 0;
  for (const phase of TASK_RECOMMENDER_V12_REPRESENTATION_PHASES.slice(1)) {
    const threshold = thresholdFor(phase, options);
    const eligible = meetsThreshold(evidence, threshold);
    gates[phase] = Object.freeze({ threshold, eligible });
    if (eligible) maximumEligibleIndex = phaseIndex(phase);
  }
  const previousIndex = phaseIndex(previousState.phase);
  const attemptIndex = Math.max(
    previousIndex,
    Math.min(maximumEligibleIndex, previousIndex + 1),
  );
  const attemptPhase = TASK_RECOMMENDER_V12_REPRESENTATION_PHASES[attemptIndex];
  return Object.freeze({
    previousState,
    attemptPhase,
    phaseAdvanced: attemptIndex > previousIndex,
    trainableLayerMask: taskRecommenderV12TrainableLayerMask(attemptPhase),
    evidence,
    gates: Object.freeze(gates),
  });
}

function inputGradient(weights, delta, inputWidth, outputWidth) {
  const result = Array(inputWidth).fill(0);
  for (let output = 0; output < outputWidth; output += 1) {
    const offset = output * inputWidth;
    for (let input = 0; input < inputWidth; input += 1) {
      result[input] += weights[offset + input] * delta[output];
    }
  }
  return result;
}

function outerGradient(input, delta) {
  const result = Array(input.length * delta.length).fill(0);
  for (let output = 0; output < delta.length; output += 1) {
    const offset = output * input.length;
    for (let index = 0; index < input.length; index += 1) {
      result[offset + index] = delta[output] * input[index];
    }
  }
  return result;
}

function clippedGradient(gradient, maximumNorm) {
  const norm = Math.sqrt(gradient.reduce((sum, value) => sum + value * value, 0));
  if (!(norm > maximumNorm) || !(maximumNorm > 0)) return gradient;
  const scale = maximumNorm / norm;
  return gradient.map((value) => value * scale);
}

function adamUpdate(values, rawGradient, key, optimizer, options = {}) {
  const gradient = clippedGradient(
    rawGradient,
    Math.max(1e-6, finite(options.maximumGradientNorm, 1)),
  );
  let moment = optimizer.moments[key];
  if (!validMoment(moment) || moment.m.length !== values.length) {
    moment = { m: Array(values.length).fill(0), v: Array(values.length).fill(0) };
    optimizer.moments[key] = moment;
  }
  const beta1 = clamp(finite(options.beta1, 0.9), 0, 0.9999);
  const beta2 = clamp(finite(options.beta2, 0.999), 0, 0.999999);
  const learningRate = clamp(finite(options.valueLearningRate, 0.0001), 1e-7, 0.002);
  const epsilon = Math.max(1e-12, finite(options.optimizerEpsilon, 1e-8));
  const correction1 = 1 - beta1 ** optimizer.step;
  const correction2 = 1 - beta2 ** optimizer.step;
  for (let index = 0; index < values.length; index += 1) {
    moment.m[index] = beta1 * moment.m[index] + (1 - beta1) * gradient[index];
    moment.v[index] = beta2 * moment.v[index] + (1 - beta2) * gradient[index] ** 2;
    const mean = moment.m[index] / Math.max(1e-12, correction1);
    const variance = moment.v[index] / Math.max(1e-12, correction2);
    values[index] -= learningRate * mean / (Math.sqrt(variance) + epsilon);
  }
}

function normalizationGradient(activation, outputGradient) {
  const biasIndex = activation.length - 1;
  const result = Array(activation.length).fill(0);
  const magnitudeSquared = activation.reduce((sum, value, index) => (
    index === biasIndex ? sum : sum + value * value
  ), 0);
  const magnitude = Math.sqrt(magnitudeSquared);
  if (!(magnitude > 1)) {
    for (let index = 0; index < biasIndex; index += 1) result[index] = outputGradient[index];
    return result;
  }
  let projection = 0;
  for (let index = 0; index < biasIndex; index += 1) {
    projection += outputGradient[index] * activation[index];
  }
  for (let index = 0; index < biasIndex; index += 1) {
    result[index] = outputGradient[index] / magnitude
      - activation[index] * projection / magnitude ** 3;
  }
  return result;
}

function layerArrays(model, name) {
  if (name === 'gru') {
    return [
      model.gru.inputUpdate, model.gru.stateUpdate, model.gru.updateBias,
      model.gru.inputReset, model.gru.stateReset, model.gru.resetBias,
      model.gru.inputCandidate, model.gru.stateCandidate, model.gru.candidateBias,
    ];
  }
  return [model[name].weights, model[name].bias];
}

function trustRadius(name, options = {}) {
  return Math.max(0, finite(
    options.representationTrustRadii?.[name],
    TASK_RECOMMENDER_V12_REPRESENTATION_TRUST_RADII[name],
  ));
}

export function projectTaskRecommenderV12ModelToTrustRegion(
  model,
  referenceModel,
  names = [],
  options = {},
) {
  const deltas = {};
  for (const name of names) {
    const arrays = layerArrays(model, name);
    const references = layerArrays(referenceModel, name);
    let squared = 0;
    arrays.forEach((values, arrayIndex) => values.forEach((value, index) => {
      const delta = value - references[arrayIndex][index];
      squared += delta * delta;
    }));
    const before = Math.sqrt(squared);
    const radius = trustRadius(name, options);
    if (before > radius && radius >= 0) {
      const scale = radius / Math.max(before, 1e-12);
      arrays.forEach((values, arrayIndex) => values.forEach((value, index) => {
        values[index] = references[arrayIndex][index]
          + (value - references[arrayIndex][index]) * scale;
      }));
    }
    deltas[name] = Object.freeze({ beforeProjection: before, afterProjection: Math.min(before, radius), radius });
  }
  return Object.freeze(deltas);
}

function updateDenseLayer(layer, input, delta, key, optimizer, options) {
  const weightsBefore = [...layer.weights];
  const inputDelta = inputGradient(
    weightsBefore,
    delta,
    layer.inputWidth,
    layer.outputWidth,
  );
  adamUpdate(layer.weights, outerGradient(input, delta), `${key}.weights`, optimizer, options);
  adamUpdate(layer.bias, delta, `${key}.bias`, optimizer, options);
  return inputDelta;
}

function updateGru(model, stateDelta, cache, optimizer, options) {
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
  const resetPreDelta = resetStateDelta.map((value, index) => (
    value * cache.previousState[index] * cache.reset[index] * (1 - cache.reset[index])
  ));
  const updatePreDelta = updateDelta.map((value, index) => (
    value * cache.update[index] * (1 - cache.update[index])
  ));
  const gates = [
    ['candidate', candidatePreDelta, cache.input, cache.resetState],
    ['reset', resetPreDelta, cache.input, cache.previousState],
    ['update', updatePreDelta, cache.input, cache.previousState],
  ];
  for (const [name, delta, input, state] of gates) {
    const suffix = name[0].toUpperCase() + name.slice(1);
    adamUpdate(
      model.gru[`input${suffix}`],
      outerGradient(input, delta),
      `gru.input${suffix}`,
      optimizer,
      options,
    );
    adamUpdate(
      model.gru[`state${suffix}`],
      outerGradient(state, delta),
      `gru.state${suffix}`,
      optimizer,
      options,
    );
    adamUpdate(
      model.gru[`${name}Bias`],
      delta,
      `gru.${name}Bias`,
      optimizer,
      options,
    );
  }
}

function applyValueGradient(model, sample, mask, optimizer, options = {}) {
  const longError = sample.longPrediction - sample.longTarget;
  const safetyError = sample.safetyPrediction - sample.safetyTarget;
  const safetyWeight = clamp(finite(options.safetyValueLossWeight, 0.5), 0, 2);
  const representationGradient = sample.representation.map((_, index) => (
    longError * model.posterior.mean[index]
      + safetyWeight * safetyError * model.safetyPosterior.mean[index]
  ));
  const normalizedDelta = normalizationGradient(
    sample.cache.representationActivation,
    representationGradient,
  );
  const representationDelta = normalizedDelta.map((value, index) => (
    value * (1 - sample.cache.representationActivation[index] ** 2)
  ));
  let interactionGradient = null;
  if (mask.interactionLayer || mask.recurrentValue) {
    interactionGradient = inputGradient(
      model.representationLayer.weights,
      representationDelta,
      model.representationLayer.inputWidth,
      model.representationLayer.outputWidth,
    );
  }
  if (mask.representationLayer) {
    updateDenseLayer(
      model.representationLayer,
      sample.cache.interaction,
      representationDelta,
      'representationLayer',
      optimizer,
      options,
    );
  }
  if (mask.interactionLayer && interactionGradient) {
    const interactionDelta = interactionGradient.map((value, index) => (
      value * (1 - sample.cache.interaction[index] ** 2)
    ));
    const interactionInputGradient = updateDenseLayer(
      model.interactionLayer,
      sample.cache.interactionInput,
      interactionDelta,
      'interactionLayer',
      optimizer,
      options,
    );
    if (mask.recurrentValue && sample.recurrentCache) {
      const width = sample.cache.recurrentState.length;
      const stateDelta = sample.cache.recurrentState.map((_, index) => (
        interactionInputGradient[index]
          + interactionInputGradient[width * 2 + index] * sample.cache.taskState[index]
      ));
      updateGru(model, stateDelta, sample.recurrentCache, optimizer, options);
    }
  }
  return {
    longSquaredError: longError ** 2,
    safetySquaredError: safetyError ** 2,
  };
}

export function trainTaskRecommenderV12ValueRepresentation(
  model,
  referenceModel,
  examples,
  sampleProvider,
  selection,
  options = {},
) {
  const mask = selection.trainableLayerMask;
  const activeNames = [
    ...(mask.representationLayer ? ['representationLayer'] : []),
    ...(mask.interactionLayer ? ['interactionLayer'] : []),
    ...(mask.recurrentValue || mask.recurrentEncoderAuxiliary ? ['gru'] : []),
    ...(mask.taskEncoderAuxiliary ? ['taskLayer'] : []),
  ];
  const previousOptimizer = selection.previousState.optimizerState;
  const optimizer = normalizeOptimizerState(previousOptimizer);
  const maximum = activeNames.length
    ? Math.min(
      examples.length,
      Math.max(0, Math.floor(finite(options.valueRepresentationMaxSteps, 64))),
    )
    : 0;
  let steps = 0;
  let longLoss = 0;
  let safetyLoss = 0;
  let projection = projectTaskRecommenderV12ModelToTrustRegion(
    model,
    referenceModel,
    activeNames,
    options,
  );
  for (let index = 0; index < maximum; index += 1) {
    const sample = sampleProvider(examples[index]);
    if (!sample) continue;
    optimizer.step += 1;
    const result = applyValueGradient(model, sample, mask, optimizer, options);
    projection = projectTaskRecommenderV12ModelToTrustRegion(
      model,
      referenceModel,
      activeNames,
      options,
    );
    longLoss += result.longSquaredError;
    safetyLoss += result.safetySquaredError;
    steps += 1;
  }
  return {
    optimizerState: optimizer,
    metrics: Object.freeze({
      phase: selection.attemptPhase,
      trainableLayerMask: mask,
      steps,
      meanLongHorizonValueLoss: steps ? longLoss / steps : 0,
      meanImmediateSafetyValueLoss: steps ? safetyLoss / steps : 0,
      trustRegion: projection,
    }),
  };
}

export function promoteTaskRecommenderV12RepresentationTrainingState(
  selection,
  trainingResult,
  targetModel,
) {
  const previous = selection.previousState;
  return normalizeTaskRecommenderV12RepresentationTrainingState({
    phase: selection.attemptPhase,
    optimizerState: trainingResult.optimizerState,
    phasePromotionCount: previous.phasePromotionCount + (selection.phaseAdvanced ? 1 : 0),
    successfulValueSteps: previous.successfulValueSteps + trainingResult.metrics.steps,
    lastEvidence: selection.evidence,
    targetCopy: {
      modelVersion: targetModel.modelVersion,
      posteriorUpdateCount: Math.max(0, Number(targetModel.posterior?.updateCount) || 0),
      safetyPosteriorUpdateCount: Math.max(
        0,
        Number(targetModel.safetyPosterior?.updateCount) || 0,
      ),
      source: 'checkpoint-target-model',
    },
  });
}
