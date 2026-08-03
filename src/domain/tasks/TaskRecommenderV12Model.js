import {
  cholesky,
  createSeededRandom,
  dense,
  dot,
  identityMatrix,
  isFiniteVector,
  normalizeRepresentation,
  randomNormal,
  sigmoid,
  solveLowerTranspose,
  solvePositiveDefinite,
  tanh,
  xavierVector,
} from './TaskRecommenderV12Math.js';

export const TASK_RECOMMENDER_V12_MODEL_VERSION = 3;
export const TASK_RECOMMENDER_V12_EVENT_WIDTH = 48;
export const TASK_RECOMMENDER_V12_STATE_WIDTH = 48;
export const TASK_RECOMMENDER_V12_TEXT_WIDTH = 64;
export const TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH = 32;
export const TASK_RECOMMENDER_V12_NUMERIC_WIDTH = 32;
export const TASK_RECOMMENDER_V12_TASK_WIDTH = 48;
export const TASK_RECOMMENDER_V12_INTERACTION_WIDTH = 64;
export const TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH = 32;

const EVENT_TYPE_SLOTS = 16;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hashString(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signedHash(vector, value, start, width, amount = 1) {
  if (!value || width <= 0) return;
  const hash = hashString(value);
  vector[start + hash % width] += (hash & 0x80000000) === 0 ? amount : -amount;
}

function logValue(value) {
  return Math.log1p(Math.max(0, finiteNumber(value)));
}

function periodicFeatures(timestampMs) {
  const seconds = timestampMs / 1000;
  return [86_400, 604_800].flatMap((period) => {
    const phase = (seconds % period) / period * 2 * Math.PI;
    return [Math.sin(phase), Math.cos(phase)];
  });
}

export function encodeTaskRecommenderV12Event(event = {}, previousOccurredAt = null) {
  const vector = Array(TASK_RECOMMENDER_V12_EVENT_WIDTH).fill(0);
  signedHash(vector, event.type || 'unknown', 0, EVENT_TYPE_SLOTS);
  const occurredAtMs = new Date(event.occurredAt || event.createdAt || Date.now()).getTime();
  const previousMs = previousOccurredAt == null ? null : new Date(previousOccurredAt).getTime();
  const elapsedSeconds = Number.isFinite(previousMs) ? (occurredAtMs - previousMs) / 1000 : 0;
  vector[16] = Math.sign(elapsedSeconds) * Math.log1p(Math.abs(elapsedSeconds));
  vector[17] = Number.isFinite(previousMs) ? 0 : 1;
  const periodic = periodicFeatures(Number.isFinite(occurredAtMs) ? occurredAtMs : 0);
  for (let index = 0; index < periodic.length; index += 1) vector[18 + index] = periodic[index];
  const payload = event.payload || {};
  vector[22] = logValue(payload.productiveSeconds);
  vector[23] = logValue(payload.proposedDurationSeconds);
  vector[24] = logValue(payload.acceptedDurationSeconds);
  vector[25] = logValue(payload.committedSeconds);
  vector[26] = logValue(payload.visibleMs);
  vector[27] = Math.sign(finiteNumber(payload.position)) * Math.log1p(Math.abs(finiteNumber(payload.position)));
  signedHash(vector, event.source || payload.source, 28, 4);
  signedHash(vector, event.taskUUID || payload.taskUUID, 32, 8);
  for (const [key, value] of Object.entries(payload)) {
    if (!Number.isFinite(Number(value))) continue;
    signedHash(vector, key, 40, 8, Math.sign(Number(value)) * Math.log1p(Math.abs(Number(value))));
  }
  return vector;
}

function createLayer(inputWidth, outputWidth, random) {
  return {
    inputWidth,
    outputWidth,
    weights: xavierVector(inputWidth, outputWidth, random),
    bias: Array(outputWidth).fill(0),
  };
}

function createGRU(inputWidth, hiddenWidth, random) {
  return {
    inputWidth,
    hiddenWidth,
    inputUpdate: xavierVector(inputWidth, hiddenWidth, random),
    stateUpdate: xavierVector(hiddenWidth, hiddenWidth, random),
    updateBias: Array(hiddenWidth).fill(-0.5),
    inputReset: xavierVector(inputWidth, hiddenWidth, random),
    stateReset: xavierVector(hiddenWidth, hiddenWidth, random),
    resetBias: Array(hiddenWidth).fill(0),
    inputCandidate: xavierVector(inputWidth, hiddenWidth, random),
    stateCandidate: xavierVector(hiddenWidth, hiddenWidth, random),
    candidateBias: Array(hiddenWidth).fill(0),
  };
}

export function createTaskRecommenderV12BayesianPosterior({
  width = TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH,
  priorPrecision = 1,
  observationVariance = 1,
} = {}) {
  const resolvedWidth = Math.max(2, Math.floor(finiteNumber(width, TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH)));
  const resolvedPrior = Math.max(1e-6, finiteNumber(priorPrecision, 1));
  return {
    width: resolvedWidth,
    priorPrecision: resolvedPrior,
    observationVariance: Math.max(1e-6, finiteNumber(observationVariance, 1)),
    precision: identityMatrix(resolvedWidth, resolvedPrior),
    naturalMean: Array(resolvedWidth).fill(0),
    mean: Array(resolvedWidth).fill(0),
    updateCount: 0,
  };
}

export function createTaskRecommenderV12Model({ seed = 'task-recommender-v12', priorPrecision = 1 } = {}) {
  const random = createSeededRandom(seed);
  return {
    modelVersion: TASK_RECOMMENDER_V12_MODEL_VERSION,
    seed: String(seed),
    dimensions: {
      event: TASK_RECOMMENDER_V12_EVENT_WIDTH,
      state: TASK_RECOMMENDER_V12_STATE_WIDTH,
      text: TASK_RECOMMENDER_V12_TEXT_WIDTH,
      categorical: TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH,
      numeric: TASK_RECOMMENDER_V12_NUMERIC_WIDTH,
      task: TASK_RECOMMENDER_V12_TASK_WIDTH,
      interaction: TASK_RECOMMENDER_V12_INTERACTION_WIDTH,
      representation: TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH,
    },
    gru: createGRU(TASK_RECOMMENDER_V12_EVENT_WIDTH, TASK_RECOMMENDER_V12_STATE_WIDTH, random),
    taskLayer: createLayer(
      TASK_RECOMMENDER_V12_TEXT_WIDTH
        + TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH
        + TASK_RECOMMENDER_V12_NUMERIC_WIDTH,
      TASK_RECOMMENDER_V12_TASK_WIDTH,
      random,
    ),
    interactionLayer: createLayer(
      TASK_RECOMMENDER_V12_STATE_WIDTH + TASK_RECOMMENDER_V12_TASK_WIDTH * 2,
      TASK_RECOMMENDER_V12_INTERACTION_WIDTH,
      random,
    ),
    representationLayer: createLayer(
      TASK_RECOMMENDER_V12_INTERACTION_WIDTH,
      TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH,
      random,
    ),
    worldLayer: createLayer(
      TASK_RECOMMENDER_V12_STATE_WIDTH,
      TASK_RECOMMENDER_V12_EVENT_WIDTH,
      random,
    ),
    taskReconstructionLayer: createLayer(
      TASK_RECOMMENDER_V12_TASK_WIDTH,
      TASK_RECOMMENDER_V12_TEXT_WIDTH
        + TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH
        + TASK_RECOMMENDER_V12_NUMERIC_WIDTH,
      random,
    ),
    posterior: createTaskRecommenderV12BayesianPosterior({ priorPrecision }),
    safetyPosterior: createTaskRecommenderV12BayesianPosterior({ priorPrecision }),
  };
}

function recurrentProjection(input, inputWeights, state, stateWeights, bias, width) {
  const inputValue = dense(input, inputWeights, bias, width);
  const stateValue = dense(state, stateWeights, Array(width).fill(0), width);
  return inputValue.map((value, index) => value + stateValue[index]);
}

export function stepTaskRecommenderV12GRUWithCache(gru, input, previousState = null) {
  if (!isFiniteVector(input, gru.inputWidth)) throw new RangeError('GRU input shape mismatch');
  const state = previousState == null ? Array(gru.hiddenWidth).fill(0) : [...previousState];
  if (!isFiniteVector(state, gru.hiddenWidth)) throw new RangeError('GRU state shape mismatch');
  const update = recurrentProjection(
    input, gru.inputUpdate, state, gru.stateUpdate, gru.updateBias, gru.hiddenWidth,
  ).map(sigmoid);
  const reset = recurrentProjection(
    input, gru.inputReset, state, gru.stateReset, gru.resetBias, gru.hiddenWidth,
  ).map(sigmoid);
  const resetState = state.map((value, index) => value * reset[index]);
  const candidate = recurrentProjection(
    input, gru.inputCandidate, resetState, gru.stateCandidate, gru.candidateBias, gru.hiddenWidth,
  ).map(tanh);
  const nextState = state.map((value, index) => (
    (1 - update[index]) * value + update[index] * candidate[index]
  ));
  return {
    state: nextState,
    cache: {
      input: [...input],
      previousState: state,
      update,
      reset,
      resetState,
      candidate,
    },
  };
}

export function stepTaskRecommenderV12GRU(gru, input, previousState = null) {
  return stepTaskRecommenderV12GRUWithCache(gru, input, previousState).state;
}

export function replayTaskRecommenderV12Events(model, events = [], initialState = null) {
  let state = initialState == null ? Array(TASK_RECOMMENDER_V12_STATE_WIDTH).fill(0) : [...initialState];
  let previousOccurredAt = null;
  for (const event of events || []) {
    const input = encodeTaskRecommenderV12Event(event, previousOccurredAt);
    state = stepTaskRecommenderV12GRU(model.gru, input, state);
    previousOccurredAt = event.occurredAt || event.createdAt || previousOccurredAt;
  }
  return state;
}

export function taskRecommenderV12RepresentationWithCache(
  model,
  recurrentState,
  encodedAction,
) {
  if (!isFiniteVector(recurrentState, TASK_RECOMMENDER_V12_STATE_WIDTH)) {
    throw new RangeError('Recurrent state shape mismatch');
  }
  if (!isFiniteVector(encodedAction?.numeric, TASK_RECOMMENDER_V12_NUMERIC_WIDTH)) {
    throw new RangeError('Encoded action numeric shape mismatch');
  }
  if (!isFiniteVector(encodedAction?.text, TASK_RECOMMENDER_V12_TEXT_WIDTH)) {
    throw new RangeError('Encoded action text shape mismatch');
  }
  if (!isFiniteVector(encodedAction?.categorical, TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH)) {
    throw new RangeError('Encoded action categorical shape mismatch');
  }
  const taskInput = [
    ...encodedAction.numeric,
    ...encodedAction.text,
    ...encodedAction.categorical,
  ];
  const taskState = dense(
    taskInput,
    model.taskLayer.weights,
    model.taskLayer.bias,
    TASK_RECOMMENDER_V12_TASK_WIDTH,
    tanh,
  );
  const interactionInput = [
    ...recurrentState,
    ...taskState,
    ...recurrentState.map((value, index) => value * taskState[index]),
  ];
  const interaction = dense(
    interactionInput,
    model.interactionLayer.weights,
    model.interactionLayer.bias,
    TASK_RECOMMENDER_V12_INTERACTION_WIDTH,
    tanh,
  );
  const representationActivation = dense(
    interaction,
    model.representationLayer.weights,
    model.representationLayer.bias,
    TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH,
    tanh,
  );
  return {
    representation: normalizeRepresentation(representationActivation),
    cache: {
      recurrentState: [...recurrentState],
      taskInput,
      taskState,
      interactionInput,
      interaction,
      representationActivation,
    },
  };
}

export function taskRecommenderV12Representation(model, recurrentState, encodedAction) {
  return taskRecommenderV12RepresentationWithCache(
    model,
    recurrentState,
    encodedAction,
  ).representation;
}

export function predictTaskRecommenderV12Posterior(posterior, representation) {
  if (!isFiniteVector(representation, posterior.width)) throw new RangeError('Posterior representation shape mismatch');
  const covarianceTimesRepresentation = solvePositiveDefinite(
    posterior.precision,
    representation,
    posterior.width,
  );
  const variance = Math.max(0, dot(representation, covarianceTimesRepresentation));
  return {
    mean: dot(posterior.mean, representation),
    epistemicVariance: variance,
    epistemicStdDev: Math.sqrt(variance),
  };
}

export function updateTaskRecommenderV12Posterior(posterior, representation, target, options = {}) {
  if (!isFiniteVector(representation, posterior.width)) throw new RangeError('Posterior representation shape mismatch');
  const resolvedTarget = finiteNumber(target, NaN);
  if (!Number.isFinite(resolvedTarget)) throw new TypeError('Posterior target must be finite');
  const sampleWeight = Math.max(0, finiteNumber(options.sampleWeight, 1));
  const observationVariance = Math.max(
    1e-6,
    finiteNumber(options.observationVariance, posterior.observationVariance),
  );
  const precisionScale = sampleWeight / observationVariance;
  for (let row = 0; row < posterior.width; row += 1) {
    posterior.naturalMean[row] += precisionScale * representation[row] * resolvedTarget;
    for (let column = 0; column < posterior.width; column += 1) {
      posterior.precision[row * posterior.width + column] += (
        precisionScale * representation[row] * representation[column]
      );
    }
  }
  posterior.mean = solvePositiveDefinite(posterior.precision, posterior.naturalMean, posterior.width);
  posterior.updateCount += 1;
  return posterior;
}

export function createTaskRecommenderV12PosteriorSampler(posterior) {
  const lower = cholesky(posterior.precision, posterior.width);
  return (random = Math.random) => {
    const standardNormal = Array.from({ length: posterior.width }, () => randomNormal(random));
    const deviation = solveLowerTranspose(lower, standardNormal, posterior.width);
    return posterior.mean.map((value, index) => value + deviation[index]);
  };
}

export function sampleTaskRecommenderV12PosteriorWeights(posterior, random = Math.random) {
  return createTaskRecommenderV12PosteriorSampler(posterior)(random);
}

export function predictTaskRecommenderV12Action(model, recurrentState, encodedAction) {
  const representation = taskRecommenderV12Representation(model, recurrentState, encodedAction);
  const longHorizon = predictTaskRecommenderV12Posterior(model.posterior, representation);
  const immediateSafety = predictTaskRecommenderV12Posterior(
    model.safetyPosterior,
    representation,
  );
  return {
    representation,
    ...longHorizon,
    safetyMean: immediateSafety.mean,
    safetyEpistemicVariance: immediateSafety.epistemicVariance,
    safetyEpistemicStdDev: immediateSafety.epistemicStdDev,
  };
}

function modelArrays(model) {
  return [
    model.gru.inputUpdate, model.gru.stateUpdate, model.gru.updateBias,
    model.gru.inputReset, model.gru.stateReset, model.gru.resetBias,
    model.gru.inputCandidate, model.gru.stateCandidate, model.gru.candidateBias,
    model.taskLayer.weights, model.taskLayer.bias,
    model.interactionLayer.weights, model.interactionLayer.bias,
    model.representationLayer.weights, model.representationLayer.bias,
    model.worldLayer.weights, model.worldLayer.bias,
    model.taskReconstructionLayer.weights, model.taskReconstructionLayer.bias,
  ];
}

function validLayer(layer, inputWidth, outputWidth) {
  return layer?.inputWidth === inputWidth
    && layer?.outputWidth === outputWidth
    && isFiniteVector(layer.weights, inputWidth * outputWidth)
    && isFiniteVector(layer.bias, outputWidth);
}

function validGRU(gru) {
  if (gru?.inputWidth !== TASK_RECOMMENDER_V12_EVENT_WIDTH
    || gru?.hiddenWidth !== TASK_RECOMMENDER_V12_STATE_WIDTH) return false;
  const inputSize = TASK_RECOMMENDER_V12_EVENT_WIDTH * TASK_RECOMMENDER_V12_STATE_WIDTH;
  const stateSize = TASK_RECOMMENDER_V12_STATE_WIDTH * TASK_RECOMMENDER_V12_STATE_WIDTH;
  return ['inputUpdate', 'inputReset', 'inputCandidate'].every((key) => (
    isFiniteVector(gru[key], inputSize)
  )) && ['stateUpdate', 'stateReset', 'stateCandidate'].every((key) => (
    isFiniteVector(gru[key], stateSize)
  )) && ['updateBias', 'resetBias', 'candidateBias'].every((key) => (
    isFiniteVector(gru[key], TASK_RECOMMENDER_V12_STATE_WIDTH)
  ));
}

export function countTaskRecommenderV12Parameters(model) {
  return modelArrays(model).reduce((sum, values) => sum + values.length, 0)
    + model.posterior.mean.length
    + model.posterior.naturalMean.length
    + model.posterior.precision.length
    + model.safetyPosterior.mean.length
    + model.safetyPosterior.naturalMean.length
    + model.safetyPosterior.precision.length;
}

export function serializeTaskRecommenderV12Model(model) {
  return JSON.parse(JSON.stringify(model));
}

export function restoreTaskRecommenderV12Model(checkpoint = {}) {
  if (Number(checkpoint.modelVersion) !== TASK_RECOMMENDER_V12_MODEL_VERSION) {
    throw new RangeError('Unsupported task recommender v12 model version');
  }
  const model = JSON.parse(JSON.stringify(checkpoint));
  if (model.dimensions?.event !== TASK_RECOMMENDER_V12_EVENT_WIDTH
    || model.dimensions?.state !== TASK_RECOMMENDER_V12_STATE_WIDTH
    || model.dimensions?.text !== TASK_RECOMMENDER_V12_TEXT_WIDTH
    || model.dimensions?.categorical !== TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH
    || model.dimensions?.numeric !== TASK_RECOMMENDER_V12_NUMERIC_WIDTH
    || model.dimensions?.task !== TASK_RECOMMENDER_V12_TASK_WIDTH
    || model.dimensions?.interaction !== TASK_RECOMMENDER_V12_INTERACTION_WIDTH
    || model.dimensions?.representation !== TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH) {
    throw new RangeError('Task recommender v12 checkpoint dimensions are incompatible');
  }
  if (!modelArrays(model).every((values) => isFiniteVector(values))) {
    throw new RangeError('Task recommender v12 checkpoint contains invalid parameters');
  }
  const taskInputWidth = TASK_RECOMMENDER_V12_NUMERIC_WIDTH
    + TASK_RECOMMENDER_V12_TEXT_WIDTH
    + TASK_RECOMMENDER_V12_CATEGORICAL_WIDTH;
  if (!validGRU(model.gru)
    || !validLayer(model.taskLayer, taskInputWidth, TASK_RECOMMENDER_V12_TASK_WIDTH)
    || !validLayer(
      model.interactionLayer,
      TASK_RECOMMENDER_V12_STATE_WIDTH + TASK_RECOMMENDER_V12_TASK_WIDTH * 2,
      TASK_RECOMMENDER_V12_INTERACTION_WIDTH,
    )
    || !validLayer(
      model.representationLayer,
      TASK_RECOMMENDER_V12_INTERACTION_WIDTH,
      TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH,
    )
    || !validLayer(
      model.worldLayer,
      TASK_RECOMMENDER_V12_STATE_WIDTH,
      TASK_RECOMMENDER_V12_EVENT_WIDTH,
    )
    || !validLayer(
      model.taskReconstructionLayer,
      TASK_RECOMMENDER_V12_TASK_WIDTH,
      taskInputWidth,
    )) {
    throw new RangeError('Task recommender v12 checkpoint tensor shapes are incompatible');
  }
  for (const [name, posterior] of [
    ['long-horizon', model.posterior],
    ['immediate-safety', model.safetyPosterior],
  ]) {
    if (posterior?.width !== TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH
      || !isFiniteVector(posterior?.mean, TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH)
      || !isFiniteVector(posterior?.naturalMean, TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH)
      || !isFiniteVector(
        posterior?.precision,
        TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH * TASK_RECOMMENDER_V12_REPRESENTATION_WIDTH,
      )) {
      throw new RangeError(`Task recommender v12 ${name} checkpoint posterior is invalid`);
    }
    cholesky(posterior.precision, posterior.width);
  }
  return model;
}
