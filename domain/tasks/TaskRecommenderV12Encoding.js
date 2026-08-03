export const TASK_RECOMMENDER_V12_ENCODER_VERSION = 2;
export const TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION = 2;
export const TASK_RECOMMENDER_V12_TEXT_HASH_WIDTH = 64;
export const TASK_RECOMMENDER_V12_CATEGORICAL_HASH_WIDTH = 32;
export const TASK_RECOMMENDER_V12_NUMERIC_WIDTH = 32;
export const TASK_RECOMMENDER_V12_DEFAULT_DURATION_POINT_COUNT = 5;

const DEFAULT_MIN_DURATION_SECONDS = 5 * 60;
const DEFAULT_MAX_DURATION_SECONDS = 3 * 60 * 60;
const DEFAULT_DURATION_QUANTUM_SECONDS = 60;

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const log1pPositive = (value) => Math.log1p(Math.max(0, toFiniteNumber(value)));

export function signedLog1p(value) {
  const number = toFiniteNumber(value);
  return Math.sign(number) * Math.log1p(Math.abs(number));
}

function timestampMs(value) {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function fnv1a(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableSerialize(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function taskText(task = {}) {
  return [task.name, task.title, task.description, ...(Array.isArray(task.tags) ? task.tags : [])]
    .filter(Boolean)
    .join('\n')
    .normalize('NFKC');
}

function textPieces(text = '') {
  const normalized = String(text || '').toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const pieces = words.slice(0, 96).map((word) => `w:${word}`);
  const compact = normalized.replace(/\s+/g, ' ').slice(0, 512);
  for (let size = 3; size <= 5; size += 1) {
    for (let index = 0; index + size <= compact.length && pieces.length < 320; index += 1) {
      pieces.push(`c${size}:${compact.slice(index, index + size)}`);
    }
  }
  return pieces;
}

export function hashTaskText(task = {}, width = TASK_RECOMMENDER_V12_TEXT_HASH_WIDTH) {
  const size = Math.max(8, Math.floor(toFiniteNumber(width, TASK_RECOMMENDER_V12_TEXT_HASH_WIDTH)));
  const vector = Array(size).fill(0);
  for (const piece of textPieces(taskText(task))) {
    const hash = fnv1a(piece);
    const index = hash % size;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function addSignedHash(vector, namespace, value, amount = 1) {
  if (value == null || value === '') return;
  const hash = fnv1a(`${namespace}:${stableSerialize(value)}`);
  vector[hash % vector.length] += (hash & 0x80000000) === 0 ? amount : -amount;
}

export function hashTaskCategoricalContext(
  task = {},
  context = {},
  width = TASK_RECOMMENDER_V12_CATEGORICAL_HASH_WIDTH,
) {
  const size = Math.max(8, Math.floor(toFiniteNumber(
    width,
    TASK_RECOMMENDER_V12_CATEGORICAL_HASH_WIDTH,
  )));
  const vector = Array(size).fill(0);
  addSignedHash(vector, 'task', task.UUID);
  addSignedHash(vector, 'project', task.projectId);
  addSignedHash(vector, 'goal', task.goalId);
  addSignedHash(vector, 'owner', task.parent);
  addSignedHash(vector, 'priority', task.priority);
  addSignedHash(vector, 'aversion', task.aversion);
  addSignedHash(vector, 'repeat', task.repeat);
  addSignedHash(vector, 'repeats', task.repeats);
  addSignedHash(vector, 'repeatRule', task.repeatRule);
  addSignedHash(vector, 'recurrence', task.recurrence);
  addSignedHash(vector, 'source', context.source);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

export function taskTextStructure(task = {}) {
  const text = taskText(task);
  const lines = text ? text.split(/\r?\n/) : [];
  const tokens = text.match(/[\p{L}\p{N}]+/gu) || [];
  const punctuation = text.match(/[.,;:!?()[\]{}]/g) || [];
  const bullets = lines.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).length;
  const digits = text.match(/\d/g) || [];
  return Object.freeze({
    characterCount: text.length,
    lineCount: lines.length,
    tokenCount: tokens.length,
    punctuationCount: punctuation.length,
    bulletLineCount: bullets,
    digitCount: digits.length,
  });
}

function portableTaskField(value) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(portableTaskField);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, portableTaskField(entry)]));
  }
  return String(value);
}

export function createTaskRecommenderV12TaskSnapshot(task = {}) {
  if (!task?.UUID) throw new TypeError('A v12 task snapshot requires UUID');
  const fields = {
    UUID: String(task.UUID),
    parent: task.parent == null ? null : String(task.parent),
    name: String(task.name || task.title || ''),
    description: String(task.description || ''),
    projectId: task.projectId == null ? null : String(task.projectId),
    goalId: task.goalId == null ? null : String(task.goalId),
    estimatedDuration: Number.isFinite(Number(task.estimatedDuration)) ? Number(task.estimatedDuration) : null,
    dueDate: task.dueDate == null ? null : portableTaskField(task.dueDate),
    createdAt: task.createdAt == null ? null : portableTaskField(task.createdAt),
    updatedAt: task.updatedAt == null ? null : portableTaskField(task.updatedAt),
    priority: task.priority == null ? null : portableTaskField(task.priority),
    aversion: task.aversion == null ? null : portableTaskField(task.aversion),
    repeat: task.repeat == null ? null : portableTaskField(task.repeat),
    repeats: task.repeats == null ? null : portableTaskField(task.repeats),
    repeatRule: task.repeatRule == null ? null : portableTaskField(task.repeatRule),
    recurrence: task.recurrence == null ? null : portableTaskField(task.recurrence),
    tags: Array.isArray(task.tags) ? task.tags.map((tag) => String(tag)) : [],
    encoderVersion: TASK_RECOMMENDER_V12_ENCODER_VERSION,
  };
  return Object.freeze({
    ...fields,
    contentHash: fnv1a(stableSerialize(fields)).toString(36),
  });
}

export function isTaskRecommenderV12EligibleTask(task = {}, playerUUID = null) {
  if (!task?.UUID) return false;
  if (playerUUID && task.parent && String(task.parent) !== String(playerUUID)) return false;
  const status = String(task.status || task.state || '').toLowerCase();
  if (['done', 'complete', 'completed', 'archived', 'deleted'].includes(status)) return false;
  return task.doNotSuggest !== true && task.recommendationBlocked !== true;
}

function quantizeDuration(value, quantum, min, max) {
  return clamp(Math.round(value / quantum) * quantum, min, max);
}

function logarithmicDurationPoints(minimum, maximum, count) {
  if (maximum <= minimum || count <= 1) return [minimum];
  const logMinimum = Math.log(minimum);
  const logMaximum = Math.log(maximum);
  return Array.from({ length: count }, (_, index) => (
    Math.exp(logMinimum + (logMaximum - logMinimum) * index / (count - 1))
  ));
}

export function buildTaskRecommenderV12DurationSupport(task = {}, constraints = {}) {
  const quantum = Math.max(1, Math.floor(toFiniteNumber(
    constraints.durationQuantumSeconds,
    DEFAULT_DURATION_QUANTUM_SECONDS,
  )));
  const requestedMinimum = Math.max(quantum, toFiniteNumber(
    constraints.minDurationSeconds,
    DEFAULT_MIN_DURATION_SECONDS,
  ));
  const requestedMaximum = Math.max(requestedMinimum, toFiniteNumber(
    constraints.maxDurationSeconds,
    DEFAULT_MAX_DURATION_SECONDS,
  ));
  const hardMaximum = Number.isFinite(Number(constraints.hardMaxDurationSeconds))
    ? Number(constraints.hardMaxDurationSeconds)
    : requestedMaximum;
  const minimum = Math.ceil(requestedMinimum / quantum) * quantum;
  const maximum = Math.floor(Math.min(requestedMaximum, hardMaximum) / quantum) * quantum;
  if (maximum < minimum) return Object.freeze([]);
  const pointCount = clamp(
    Math.floor(toFiniteNumber(
      constraints.durationPointCount,
      TASK_RECOMMENDER_V12_DEFAULT_DURATION_POINT_COUNT,
    )),
    2,
    9,
  );
  const candidates = logarithmicDurationPoints(minimum, maximum, pointCount);
  const estimateSeconds = Number.isFinite(Number(task.estimatedDuration))
    && Number(task.estimatedDuration) > 0
    ? Number(task.estimatedDuration) * 60
    : null;
  const requestedSeconds = Number.isFinite(Number(constraints.targetDurationSeconds))
    && Number(constraints.targetDurationSeconds) > 0
    ? Number(constraints.targetDurationSeconds)
    : null;
  if (estimateSeconds != null) candidates.push(estimateSeconds);
  if (requestedSeconds != null) candidates.push(requestedSeconds);
  return Object.freeze([...new Set(candidates.map((value) => (
    quantizeDuration(value, quantum, minimum, maximum)
  )))].sort((left, right) => left - right));
}

export function buildTaskRecommenderV12ActionSet(tasks = [], constraints = {}) {
  const playerUUID = constraints.playerUUID || null;
  const uniqueTasks = new Map();
  for (const task of tasks || []) {
    if (!isTaskRecommenderV12EligibleTask(task, playerUUID)) continue;
    if (!uniqueTasks.has(String(task.UUID))) uniqueTasks.set(String(task.UUID), task);
  }
  const actions = [];
  for (const task of uniqueTasks.values()) {
    const taskSnapshot = createTaskRecommenderV12TaskSnapshot(task);
    for (const durationSeconds of buildTaskRecommenderV12DurationSupport(task, constraints)) {
      actions.push(Object.freeze({
        actionSchemaVersion: TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
        actionKey: `${taskSnapshot.UUID}:${durationSeconds}`,
        taskUUID: taskSnapshot.UUID,
        durationSeconds,
        durationQuantumSeconds: Math.max(1, Math.floor(toFiniteNumber(
          constraints.durationQuantumSeconds,
          DEFAULT_DURATION_QUANTUM_SECONDS,
        ))),
        taskSnapshot,
      }));
    }
  }
  return Object.freeze(actions);
}

export function buildTaskRecommenderV12TaskExposure(events = [], before = null) {
  const beforeMs = timestampMs(before);
  const byTask = new Map();
  for (const event of events || []) {
    const occurredAtMs = timestampMs(event?.occurredAt || event?.createdAt);
    if (beforeMs != null && occurredAtMs != null && occurredAtMs >= beforeMs) continue;
    const taskUUID = event?.taskUUID == null ? null : String(event.taskUUID);
    if (!taskUUID) continue;
    const current = byTask.get(taskUUID) || {
      presentationCount: 0,
      skipCount: 0,
      verifiedSessionCount: 0,
      lastPresentationTimestampMs: null,
    };
    if (event.type === 'recommendation_presented') {
      current.presentationCount += 1;
      current.lastPresentationTimestampMs = occurredAtMs ?? current.lastPresentationTimestampMs;
    } else if (event.type === 'recommendation_skipped') {
      current.skipCount += 1;
    } else if (event.type === 'task_session_finished'
      && Number(event.payload?.sessionTimingSchemaVersion) === 1) {
      current.verifiedSessionCount += 1;
    }
    byTask.set(taskUUID, current);
  }
  return Object.freeze(Object.fromEntries([...byTask.entries()].map(([taskUUID, value]) => [
    taskUUID,
    Object.freeze({ ...value }),
  ])));
}

function periodicTimeFeatures(nowMs) {
  const daySeconds = 24 * 60 * 60;
  const weekSeconds = 7 * daySeconds;
  const epochSeconds = nowMs / 1000;
  return [daySeconds, weekSeconds].flatMap((period) => {
    const phase = (epochSeconds % period) / period * 2 * Math.PI;
    return [Math.sin(phase), Math.cos(phase)];
  });
}

export function encodeTaskRecommenderV12Action(action = {}, context = {}) {
  const snapshot = action.taskSnapshot || createTaskRecommenderV12TaskSnapshot(action.task || {});
  const nowMs = timestampMs(context.now || Date.now()) || Date.now();
  const dueMs = timestampMs(snapshot.dueDate);
  const createdMs = timestampMs(snapshot.createdAt);
  const updatedMs = timestampMs(snapshot.updatedAt);
  const dueDeltaSeconds = dueMs == null ? 0 : (dueMs - nowMs) / 1000;
  const createdDeltaSeconds = createdMs == null ? 0 : (createdMs - nowMs) / 1000;
  const updatedDeltaSeconds = updatedMs == null ? 0 : (updatedMs - nowMs) / 1000;
  const estimateSeconds = Math.max(0, toFiniteNumber(snapshot.estimatedDuration) * 60);
  const proposedDurationSeconds = Math.max(0, toFiniteNumber(action.durationSeconds));
  const priorityNumber = Number(snapshot.priority);
  const aversionNumber = Number(snapshot.aversion);
  const priorityNumeric = snapshot.priority != null
    && snapshot.priority !== ''
    && Number.isFinite(priorityNumber);
  const aversionNumeric = snapshot.aversion != null
    && snapshot.aversion !== ''
    && Number.isFinite(aversionNumber);
  const recurrencePresent = [snapshot.repeat, snapshot.repeats, snapshot.repeatRule, snapshot.recurrence]
    .some((value) => value != null && value !== '' && value !== false);
  const exposure = context.taskExposureByUUID?.[snapshot.UUID] || {};
  const lastPresentationMs = timestampMs(exposure.lastPresentationTimestampMs);
  const sinceLastPresentationSeconds = lastPresentationMs == null
    ? 0
    : (nowMs - lastPresentationMs) / 1000;
  const structure = taskTextStructure(snapshot);
  return Object.freeze({
    encoderVersion: TASK_RECOMMENDER_V12_ENCODER_VERSION,
    taskUUID: snapshot.UUID,
    actionKey: action.actionKey || `${snapshot.UUID}:${proposedDurationSeconds}`,
    raw: Object.freeze({
      nowTimestampMs: nowMs,
      dueTimestampMs: dueMs,
      createdTimestampMs: createdMs,
      updatedTimestampMs: updatedMs,
      dueDeltaSeconds,
      createdDeltaSeconds,
      updatedDeltaSeconds,
      estimateSeconds,
      proposedDurationSeconds,
      priority: snapshot.priority,
      aversion: snapshot.aversion,
      recurrencePresent,
      presentationCount: Math.max(0, toFiniteNumber(exposure.presentationCount)),
      skipCount: Math.max(0, toFiniteNumber(exposure.skipCount)),
      verifiedSessionCount: Math.max(0, toFiniteNumber(exposure.verifiedSessionCount)),
      lastPresentationTimestampMs: lastPresentationMs,
      queueSize: Math.max(0, toFiniteNumber(context.queueSize)),
      source: context.source == null ? null : String(context.source),
    }),
    numeric: Object.freeze([
      dueMs == null ? 1 : 0,
      signedLog1p(dueDeltaSeconds),
      createdMs == null ? 1 : 0,
      signedLog1p(createdDeltaSeconds),
      estimateSeconds > 0 ? 0 : 1,
      log1pPositive(estimateSeconds),
      log1pPositive(proposedDurationSeconds),
      log1pPositive(structure.characterCount),
      log1pPositive(structure.lineCount),
      log1pPositive(structure.tokenCount),
      log1pPositive(structure.punctuationCount),
      log1pPositive(structure.bulletLineCount),
      log1pPositive(structure.digitCount),
      ...periodicTimeFeatures(nowMs),
      updatedMs == null ? 1 : 0,
      signedLog1p(updatedDeltaSeconds),
      priorityNumeric ? 0 : 1,
      priorityNumeric ? signedLog1p(priorityNumber) : 0,
      aversionNumeric ? 0 : 1,
      aversionNumeric ? signedLog1p(aversionNumber) : 0,
      recurrencePresent ? 1 : 0,
      signedLog1p(proposedDurationSeconds - estimateSeconds),
      log1pPositive(exposure.presentationCount),
      log1pPositive(exposure.skipCount),
      log1pPositive(exposure.verifiedSessionCount),
      lastPresentationMs == null ? 1 : 0,
      signedLog1p(sinceLastPresentationSeconds),
      log1pPositive(context.queueSize),
      log1pPositive(proposedDurationSeconds / Math.max(1, estimateSeconds)),
    ]),
    text: Object.freeze(hashTaskText(snapshot)),
    categorical: Object.freeze(hashTaskCategoricalContext(snapshot, context)),
  });
}
