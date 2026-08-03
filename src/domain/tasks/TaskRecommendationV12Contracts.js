export const TASK_RECOMMENDATION_V12_CONTRACT_VERSION = 6;
export const TASK_RECOMMENDATION_V12_CHECKPOINT_FORMAT = 'tapestry-task-recommender-v12-checkpoint';
export const TASK_RECOMMENDATION_V12_TRAINING_FORMAT = 'tapestry-task-recommender-v12-training-data';
export const TASK_RECOMMENDATION_V12_BUNDLE_FORMAT = 'tapestry-task-recommender-v12-bundle';
export const TASK_RECOMMENDATION_V12_IMPORT_MODE = 'atomic-commit';

export const TASK_RECOMMENDATION_V12_REMOVED_PROTOCOL_FIELDS = Object.freeze([
  'proxyHead',
  'proxyHeads',
  'headModels',
  'syntheticWeights',
  'syntheticBootstrapEvents',
  'weightControls',
  'weights',
  'utilityWeights',
  'featureCounts',
  'stumps',
  'deepGate',
  'embeddingDimensions',
  'semanticFeatures',
  'semanticFeatureVector',
  'semanticEmbedding',
  'semanticVector',
  'features',
  'planningAuthority',
  'planningScore',
  'planningCandidates',
  'durationLadder',
  'durationLadders',
  'durationCandidates',
  'candidateDurations',
  'durationBuckets',
  'portableDerived',
]);

const REMOVED_PROTOCOL_FIELD_SET = new Set(
  TASK_RECOMMENDATION_V12_REMOVED_PROTOCOL_FIELDS.map((key) => key.toLowerCase()),
);

export function stripTaskRecommendationV12RemovedProtocolFields(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripTaskRecommendationV12RemovedProtocolFields(entry));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !REMOVED_PROTOCOL_FIELD_SET.has(String(key).toLowerCase()))
    .map(([key, entry]) => [key, stripTaskRecommendationV12RemovedProtocolFields(entry)]));
}

export function findTaskRecommendationV12RemovedProtocolFields(value, path = '$') {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => (
      findTaskRecommendationV12RemovedProtocolFields(entry, `${path}[${index}]`)
    ));
  }
  if (!value || typeof value !== 'object') return [];
  const found = [];
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (REMOVED_PROTOCOL_FIELD_SET.has(String(key).toLowerCase())) found.push(nextPath);
    found.push(...findTaskRecommendationV12RemovedProtocolFields(entry, nextPath));
  }
  return found;
}

const finite = (value) => Number.isFinite(Number(value));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function iso(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new TypeError(`${label} must be an ISO timestamp`);
  return date.toISOString();
}

function assertFormat(value, format, label) {
  if (!object(value) || value.format !== format || Number(value.formatVersion) !== 1) {
    throw new TypeError(`Invalid ${label} contract`);
  }
}

export function createTaskRecommendationV12CheckpointContract({
  playerUUID,
  model,
  targetModel = model,
  manifest = null,
  exportedAt = new Date().toISOString(),
} = {}) {
  const owner = requiredText(playerUUID, 'playerUUID');
  if (!object(model) || Number(model.modelVersion) !== 3) {
    throw new TypeError('A v12 checkpoint requires modelVersion 3');
  }
  if (!object(targetModel) || Number(targetModel.modelVersion) !== 3) {
    throw new TypeError('A v12 checkpoint requires targetModel modelVersion 3');
  }
  return Object.freeze({
    format: TASK_RECOMMENDATION_V12_CHECKPOINT_FORMAT,
    formatVersion: 1,
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    playerUUID: owner,
    exportedAt: iso(exportedAt, 'exportedAt'),
    checkpoint: Object.freeze({
      model: clone(model),
      targetModel: clone(targetModel),
      manifest: manifest == null ? null : clone(manifest),
    }),
  });
}

export function parseTaskRecommendationV12CheckpointContract(value, { playerUUID = null } = {}) {
  assertFormat(value, TASK_RECOMMENDATION_V12_CHECKPOINT_FORMAT, 'v12 checkpoint');
  const owner = requiredText(value.playerUUID, 'playerUUID');
  if (playerUUID != null && owner !== String(playerUUID)) throw new TypeError('Checkpoint playerUUID mismatch');
  return createTaskRecommendationV12CheckpointContract({
    playerUUID: owner,
    model: value.checkpoint?.model,
    targetModel: value.checkpoint?.targetModel,
    manifest: value.checkpoint?.manifest,
    exportedAt: value.exportedAt,
  });
}

export function createTaskRecommendationV12TrainingContract({
  playerUUID,
  events = [],
  exportedAt = new Date().toISOString(),
  cursor = null,
} = {}) {
  const owner = requiredText(playerUUID, 'playerUUID');
  if (!Array.isArray(events)) throw new TypeError('v12 training events must be an array');
  const normalizedEvents = events.map((event, index) => {
    if (!object(event) || event.protocolFamily !== 'task-recommender-v12') {
      throw new TypeError(`Training event ${index} is not a v12 protocol event`);
    }
    if (String(event.parent || '') !== owner) {
      throw new TypeError(`Training event ${index} belongs to another profile`);
    }
    return stripTaskRecommendationV12RemovedProtocolFields(clone(event));
  }).sort((left, right) => (
    Number(left.sequence || 0) - Number(right.sequence || 0)
    || String(left.occurredAt || '').localeCompare(String(right.occurredAt || ''))
    || String(left.UUID || '').localeCompare(String(right.UUID || ''))
  ));
  return Object.freeze({
    format: TASK_RECOMMENDATION_V12_TRAINING_FORMAT,
    formatVersion: 1,
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    protocolSchemaVersion: 2,
    playerUUID: owner,
    exportedAt: iso(exportedAt, 'exportedAt'),
    cursor: cursor == null ? null : clone(cursor),
    events: Object.freeze(normalizedEvents),
  });
}

export function parseTaskRecommendationV12TrainingContract(value, { playerUUID = null } = {}) {
  assertFormat(value, TASK_RECOMMENDATION_V12_TRAINING_FORMAT, 'v12 training data');
  const owner = requiredText(value.playerUUID, 'playerUUID');
  if (playerUUID != null && owner !== String(playerUUID)) throw new TypeError('Training-data playerUUID mismatch');
  return createTaskRecommendationV12TrainingContract({
    playerUUID: owner,
    events: value.events,
    exportedAt: value.exportedAt,
    cursor: value.cursor,
  });
}

export function createTaskRecommendationV12TrainingRequest({
  requestId,
  playerUUID,
  options = {},
} = {}) {
  if (!object(options)) throw new TypeError('Training options must be an object');
  return Object.freeze({
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    requestId: requiredText(requestId, 'requestId'),
    playerUUID: requiredText(playerUUID, 'playerUUID'),
    options: Object.freeze(clone(options)),
  });
}

export function createTaskRecommendationV12TrainingResult({
  request,
  status,
  checkpoint,
  metrics = null,
  trainedThroughSequence = null,
} = {}) {
  const normalizedRequest = createTaskRecommendationV12TrainingRequest(request);
  const normalizedCheckpoint = parseTaskRecommendationV12CheckpointContract(
    checkpoint,
    { playerUUID: normalizedRequest.playerUUID },
  );
  return Object.freeze({
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    requestId: normalizedRequest.requestId,
    playerUUID: normalizedRequest.playerUUID,
    status: requiredText(status, 'status'),
    trainedThroughSequence: trainedThroughSequence == null
      ? null
      : Math.max(0, Math.floor(Number(trainedThroughSequence) || 0)),
    metrics: metrics == null ? null : clone(metrics),
    checkpoint: normalizedCheckpoint,
  });
}

export function createTaskRecommendationV12InferenceRequest({
  requestId,
  playerUUID,
  source = 'tasks',
  decisionSeed,
  now = new Date().toISOString(),
  tasks = [],
  constraints = {},
} = {}) {
  if (!Array.isArray(tasks)) throw new TypeError('Inference tasks must be an array');
  return Object.freeze({
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    requestId: requiredText(requestId, 'requestId'),
    playerUUID: requiredText(playerUUID, 'playerUUID'),
    source: requiredText(source, 'source'),
    decisionSeed: requiredText(decisionSeed, 'decisionSeed'),
    now: iso(now, 'now'),
    tasks: Object.freeze(tasks.map((task) => clone(task))),
    constraints: Object.freeze(clone(constraints || {})),
  });
}

export function createTaskRecommendationV12InferenceResult({
  request,
  selected = null,
  mode = 'production-v12',
  behaviorProbability = null,
  diagnostics = null,
} = {}) {
  const normalizedRequest = createTaskRecommendationV12InferenceRequest(request);
  let normalizedSelected = null;
  if (selected != null) {
    if (!object(selected)) throw new TypeError('Inference selection must be an object or null');
    const taskUUID = requiredText(selected.taskUUID, 'selected.taskUUID');
    const durationSeconds = Number(selected.durationSeconds);
    if (!finite(durationSeconds) || durationSeconds <= 0) {
      throw new TypeError('selected.durationSeconds must be positive');
    }
    normalizedSelected = Object.freeze({
      actionKey: requiredText(selected.actionKey, 'selected.actionKey'),
      taskUUID,
      durationSeconds,
      predictedWorkHours: finite(selected.predictedWorkHours)
        ? Number(selected.predictedWorkHours)
        : null,
      epistemicStdDevHours: finite(selected.epistemicStdDevHours)
        ? Math.max(0, Number(selected.epistemicStdDevHours))
        : null,
    });
  }
  const probability = behaviorProbability == null ? null : Number(behaviorProbability);
  if (probability != null && (!finite(probability) || probability < 0 || probability > 1)) {
    throw new TypeError('behaviorProbability must be between 0 and 1');
  }
  return Object.freeze({
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    requestId: normalizedRequest.requestId,
    playerUUID: normalizedRequest.playerUUID,
    source: normalizedRequest.source,
    mode: String(mode || 'production-v12'),
    selected: normalizedSelected,
    behaviorProbability: probability,
    diagnostics: diagnostics == null ? null : clone(diagnostics),
  });
}

export function createTaskRecommendationV12BundleContract({
  playerUUID,
  checkpoint,
  trainingData,
  recoveryEvidence,
  candidateSnapshots = [],
  exportedAt = new Date().toISOString(),
} = {}) {
  const owner = requiredText(playerUUID, 'playerUUID');
  const parsedCheckpoint = parseTaskRecommendationV12CheckpointContract(checkpoint, { playerUUID: owner });
  const parsedTraining = parseTaskRecommendationV12TrainingContract(trainingData, { playerUUID: owner });
  if (!object(recoveryEvidence)) throw new TypeError('recoveryEvidence is required');
  if (!Array.isArray(candidateSnapshots)) throw new TypeError('candidateSnapshots must be an array');
  const normalizedSnapshots = candidateSnapshots.map((record, index) => {
    if (!object(record)
      || String(record.parent || '') !== owner
      || !object(record.value?.snapshot)
      || !record.value?.contentHash
      || String(record.value.snapshot.contentHash || '') !== String(record.value.contentHash)
      || !String(record.UUID || '').endsWith(`:${record.value.contentHash}`)) {
      throw new TypeError(`Candidate snapshot ${index} is invalid`);
    }
    return clone(record);
  });
  return Object.freeze({
    format: TASK_RECOMMENDATION_V12_BUNDLE_FORMAT,
    formatVersion: 2,
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    playerUUID: owner,
    exportedAt: iso(exportedAt, 'exportedAt'),
    checkpoint: parsedCheckpoint,
    trainingData: parsedTraining,
    candidateSnapshots: Object.freeze(normalizedSnapshots),
    recoveryEvidence: Object.freeze(clone(recoveryEvidence)),
  });
}

export function parseTaskRecommendationV12BundleContract(payload, { playerUUID = null } = {}) {
  const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!object(value)
    || value.format !== TASK_RECOMMENDATION_V12_BUNDLE_FORMAT
    || Number(value.formatVersion) !== 2) {
    throw new TypeError('Invalid v12 bundle contract');
  }
  const owner = requiredText(value.playerUUID, 'playerUUID');
  if (playerUUID != null && owner !== String(playerUUID)) throw new TypeError('Bundle playerUUID mismatch');
  return createTaskRecommendationV12BundleContract({
    playerUUID: owner,
    checkpoint: value.checkpoint,
    trainingData: value.trainingData,
    candidateSnapshots: value.candidateSnapshots || [],
    recoveryEvidence: value.recoveryEvidence,
    exportedAt: value.exportedAt,
  });
}

export function buildTaskRecommendationV12ImportContract(payload, { targetPlayerUUID = null } = {}) {
  const parsed = parseTaskRecommendationV12BundleContract(payload);
  const target = targetPlayerUUID == null ? parsed.playerUUID : requiredText(targetPlayerUUID, 'targetPlayerUUID');
  return Object.freeze({
    contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
    mode: TASK_RECOMMENDATION_V12_IMPORT_MODE,
    sourcePlayerUUID: parsed.playerUUID,
    targetPlayerUUID: target,
    writesActiveArtifacts: true,
    requiresExplicitCutoverCommit: false,
    checkpoint: parsed.checkpoint,
    trainingData: parsed.trainingData,
    candidateSnapshots: parsed.candidateSnapshots,
    recoveryEvidence: parsed.recoveryEvidence,
  });
}
