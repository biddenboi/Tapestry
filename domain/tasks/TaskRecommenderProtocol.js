export const TASK_RECOMMENDER_PROTOCOL_FAMILY = 'task-recommender-v12';
export const TASK_RECOMMENDER_PROTOCOL_SCHEMA_VERSION = 2;
export const TASK_RECOMMENDER_PROTOCOL_RECORD_TYPE = 'task-recommender-protocol-event';
export const TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION = 1;

export const TASK_RECOMMENDER_EVENT_TYPES = Object.freeze({
  decisionCreated: 'recommendation_decision_created',
  recommendationInvalidated: 'recommendation_invalidated',
  recommendationPresented: 'recommendation_presented',
  recommendationVisibilityAccumulated: 'recommendation_visibility_accumulated',
  recommendationSkipped: 'recommendation_skipped',
  recommendationAccepted: 'recommendation_accepted',
  taskSessionStarted: 'task_session_started',
  taskSessionDurationChanged: 'task_session_duration_changed',
  taskSessionFinished: 'task_session_finished',
  taskRecordedComplete: 'task_recorded_complete',
  manualAlternativeSelected: 'manual_alternative_selected',
});

const EVENT_TYPE_SET = new Set(Object.values(TASK_RECOMMENDER_EVENT_TYPES));

function portableClone(value, seen = new WeakSet()) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => portableClone(entry, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = portableClone(entry, seen);
    if (cloned !== undefined) result[key] = cloned;
  }
  seen.delete(value);
  return result;
}

function normalizedISO(value, fallback = null) {
  const date = value instanceof Date ? value : new Date(value || fallback || Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError('Task recommender event requires a valid timestamp');
  return date.toISOString();
}

function requiredIdentifier(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`Task recommender event requires ${label}`);
  return normalized;
}

export function hashTaskRecommenderProtocolKey(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function taskRecommenderProtocolEventUUID(decisionUUID, eventType, eventKey = eventType) {
  const decision = requiredIdentifier(decisionUUID, 'decisionUUID');
  const type = requiredIdentifier(eventType, 'event type');
  return `task-rec-v12:${hashTaskRecommenderProtocolKey(`${decision}|${type}|${eventKey}`)}`;
}

export function isTaskRecommenderProtocolEvent(value = null) {
  return Boolean(
    value
    && value.protocolFamily === TASK_RECOMMENDER_PROTOCOL_FAMILY
    && value.recordType === TASK_RECOMMENDER_PROTOCOL_RECORD_TYPE
    && EVENT_TYPE_SET.has(value.type),
  );
}

export function createTaskRecommenderProtocolEvent({
  UUID = null,
  playerUUID = null,
  parent = null,
  decisionUUID = null,
  type = null,
  eventKey = null,
  occurredAt = null,
  recordedAt = null,
  sequence = null,
  source = null,
  taskUUID = null,
  origin = 'user',
  payload = {},
} = {}) {
  const resolvedPlayerUUID = requiredIdentifier(playerUUID || parent, 'playerUUID');
  const resolvedDecisionUUID = requiredIdentifier(decisionUUID, 'decisionUUID');
  const resolvedType = requiredIdentifier(type, 'event type');
  if (!EVENT_TYPE_SET.has(resolvedType)) {
    throw new TypeError(`Unsupported task recommender event type: ${resolvedType}`);
  }
  const resolvedOccurredAt = normalizedISO(occurredAt);
  const resolvedRecordedAt = normalizedISO(recordedAt, resolvedOccurredAt);
  const resolvedEventKey = String(eventKey || `${resolvedType}:${resolvedOccurredAt}`);
  const resolvedSequence = sequence == null ? null : Math.max(1, Math.floor(Number(sequence)));
  if (sequence != null && !Number.isFinite(resolvedSequence)) {
    throw new TypeError('Task recommender event sequence must be finite');
  }
  return Object.freeze({
    UUID: UUID || taskRecommenderProtocolEventUUID(resolvedDecisionUUID, resolvedType, resolvedEventKey),
    parent: resolvedPlayerUUID,
    protocolFamily: TASK_RECOMMENDER_PROTOCOL_FAMILY,
    protocolSchemaVersion: TASK_RECOMMENDER_PROTOCOL_SCHEMA_VERSION,
    recordType: TASK_RECOMMENDER_PROTOCOL_RECORD_TYPE,
    type: resolvedType,
    decisionUUID: resolvedDecisionUUID,
    eventKey: resolvedEventKey,
    idempotencyKey: `${resolvedDecisionUUID}:${resolvedEventKey}`,
    sequence: resolvedSequence,
    source: source == null ? null : String(source),
    taskUUID: taskUUID == null ? null : String(taskUUID),
    origin: String(origin || 'user'),
    occurredAt: resolvedOccurredAt,
    recordedAt: resolvedRecordedAt,
    createdAt: resolvedRecordedAt,
    payload: portableClone(payload) || {},
  });
}

export function compareTaskRecommenderProtocolEvents(left = {}, right = {}) {
  const leftSequence = Number(left.sequence);
  const rightSequence = Number(right.sequence);
  if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  const timeComparison = String(left.occurredAt || '').localeCompare(String(right.occurredAt || ''));
  if (timeComparison) return timeComparison;
  return String(left.UUID || '').localeCompare(String(right.UUID || ''));
}

export function reduceTaskRecommenderDecision(events = [], decisionUUID = null) {
  const relevant = (events || [])
    .filter(isTaskRecommenderProtocolEvent)
    .filter((event) => !decisionUUID || String(event.decisionUUID) === String(decisionUUID))
    .sort(compareTaskRecommenderProtocolEvents);
  const resolvedDecisionUUID = decisionUUID || relevant[0]?.decisionUUID || null;
  const state = {
    decisionUUID: resolvedDecisionUUID,
    playerUUID: relevant[0]?.parent || null,
    source: null,
    observationSessionUUID: null,
    taskUUID: null,
    status: 'missing',
    createdAt: null,
    presentedAt: null,
    invalidatedAt: null,
    acceptedAt: null,
    skippedAt: null,
    sessionStartedAt: null,
    sessionFinishedAt: null,
    completedAt: null,
    proposedDurationSeconds: null,
    acceptedDurationSeconds: null,
    productiveSeconds: 0,
    visibleMs: 0,
    visibilityEventCount: 0,
    eventCount: relevant.length,
    violations: [],
  };
  for (const event of relevant) {
    state.source ||= event.source || null;
    state.taskUUID ||= event.taskUUID || null;
    const payload = event.payload || {};
    if (event.type === TASK_RECOMMENDER_EVENT_TYPES.decisionCreated) {
      state.createdAt ||= event.occurredAt;
      state.observationSessionUUID ||= payload.observationSessionUUID == null
        ? null
        : String(payload.observationSessionUUID);
      state.proposedDurationSeconds ??= Number.isFinite(Number(payload.proposedDurationSeconds))
        ? Math.max(0, Number(payload.proposedDurationSeconds))
        : null;
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.recommendationInvalidated) {
      state.invalidatedAt ||= event.occurredAt;
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented) {
      state.presentedAt ||= event.occurredAt;
      state.visibleMs += Math.max(0, Number(payload.visibleMs) || 0);
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.recommendationVisibilityAccumulated) {
      state.visibleMs += Math.max(0, Number(payload.visibleMs) || 0);
      state.visibilityEventCount += 1;
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped) {
      state.skippedAt ||= event.occurredAt;
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.recommendationAccepted) {
      state.acceptedAt ||= event.occurredAt;
      state.acceptedDurationSeconds ??= Number.isFinite(Number(payload.acceptedDurationSeconds))
        ? Math.max(0, Number(payload.acceptedDurationSeconds))
        : null;
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.taskSessionStarted) {
      state.sessionStartedAt ||= event.occurredAt;
      state.acceptedDurationSeconds ??= Number.isFinite(Number(payload.acceptedDurationSeconds))
        ? Math.max(0, Number(payload.acceptedDurationSeconds))
        : null;
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.taskSessionDurationChanged) {
      if (Number.isFinite(Number(payload.acceptedDurationSeconds))) {
        state.acceptedDurationSeconds = Math.max(0, Number(payload.acceptedDurationSeconds));
      }
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished) {
      state.sessionFinishedAt = event.occurredAt;
      state.productiveSeconds += Math.max(0, Number(payload.productiveSeconds) || 0);
    } else if (event.type === TASK_RECOMMENDER_EVENT_TYPES.taskRecordedComplete) {
      state.completedAt = event.occurredAt;
    }
  }
  if (state.skippedAt && (state.acceptedAt || state.sessionStartedAt)) {
    state.violations.push('decision-has-both-skip-and-acceptance');
  }
  if (state.completedAt) state.status = 'completed';
  else if (state.sessionFinishedAt) state.status = 'session-finished';
  else if (state.sessionStartedAt) state.status = 'session-active';
  else if (state.acceptedAt) state.status = 'accepted';
  else if (state.skippedAt) state.status = 'skipped';
  else if (state.presentedAt) state.status = 'presented';
  else if (state.invalidatedAt) state.status = 'invalidated';
  else if (state.createdAt) state.status = 'created';
  return state;
}

export function countTaskRecommenderResolvedDecisions(events = []) {
  const byDecision = new Map();
  for (const event of events || []) {
    if (!isTaskRecommenderProtocolEvent(event)) continue;
    if (!byDecision.has(event.decisionUUID)) byDecision.set(event.decisionUUID, []);
    byDecision.get(event.decisionUUID).push(event);
  }
  let count = 0;
  for (const [decisionUUID, decisionEvents] of byDecision) {
    const created = decisionEvents.find((event) => (
      event.type === TASK_RECOMMENDER_EVENT_TYPES.decisionCreated
    ));
    if (!created?.taskUUID || !created.payload?.taskSnapshot) continue;
    const state = reduceTaskRecommenderDecision(decisionEvents, decisionUUID);
    if (['skipped', 'session-finished', 'completed'].includes(state.status)) count += 1;
  }
  return count;
}
