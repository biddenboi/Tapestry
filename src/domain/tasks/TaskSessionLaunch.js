const LEGACY_MATCH_ANCHOR_MIN_AGE_MS = 12 * 60 * 60 * 1000;
const TIMESTAMP_TOLERANCE_MS = 1_000;

function timestampMs(value) {
  const parsed = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isoAt(value, fallbackMs = Date.now()) {
  const parsed = timestampMs(value);
  const safeFallback = Number.isFinite(Number(fallbackMs)) ? Number(fallbackMs) : Date.now();
  return new Date(parsed ?? safeFallback).toISOString();
}

export function taskSessionRequestKey(task) {
  if (!task) return null;
  if (task.actionSessionUUID) return String(task.actionSessionUUID);
  const requestedAtMs = timestampMs(task.sessionRequestedAt);
  if (requestedAtMs == null) return null;
  return `${task.UUID || 'task'}:${new Date(requestedAtMs).toISOString()}`;
}

export function taskSessionRequestedAt(task, fallbackMs = Date.now()) {
  return isoAt(task?.sessionRequestedAt, fallbackMs);
}

export function repairLegacyMatchSessionAnchor(record, todo, nowMs = Date.now()) {
  if (!record || !todo) return record;
  if (record.outcome !== 'active' || record.source !== 'match' || record.pausedAt) return record;
  if (Math.max(0, Number(record.activeDurationMs) || 0) > 0) return record;
  if (Math.max(0, Number(record.pausedDurationMs) || 0) > 0) return record;

  const startedAtMs = timestampMs(record.startedAt);
  const activeAnchorAtMs = timestampMs(record.activeAnchorAt);
  const todoCreatedAtMs = timestampMs(todo.createdAt);
  const currentMs = Number(nowMs);
  if (
    startedAtMs == null
    || activeAnchorAtMs == null
    || todoCreatedAtMs == null
    || !Number.isFinite(currentMs)
  ) return record;

  const isTaskCreationAnchor = Math.abs(startedAtMs - todoCreatedAtMs) <= TIMESTAMP_TOLERANCE_MS;
  const anchorMatchesStart = Math.abs(activeAnchorAtMs - startedAtMs) <= TIMESTAMP_TOLERANCE_MS;
  const isOldEnoughToBeLegacyBug = currentMs - startedAtMs >= LEGACY_MATCH_ANCHOR_MIN_AGE_MS;
  if (!isTaskCreationAnchor || !anchorMatchesStart || !isOldEnoughToBeLegacyBug) return record;

  const repairedAt = new Date(currentMs).toISOString();
  return {
    ...record,
    startedAt: repairedAt,
    activeAnchorAt: repairedAt,
    updatedAt: repairedAt,
  };
}
