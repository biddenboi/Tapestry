import { STORES } from '@domain/constants.js';

function firstPositiveIGT(values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

function completedRecordIGT(record, { includeResult = false } = {}) {
  const completionCandidates = [
    record?.completedInGameTimestamp,
    ...(includeResult ? [record?.result?.inGameTimestamp] : []),
  ];
  const completed = firstPositiveIGT(completionCandidates);
  if (completed != null) return completed;

  const started = Number(record?.inGameTimestamp);
  if (Number.isFinite(started)) return Math.max(0, started);

  for (const value of completionCandidates) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return null;
}

export function getRecordVisibilityIGT(store, record) {
  if (store === STORES.task) return completedRecordIGT(record);
  if (store === STORES.match) return completedRecordIGT(record, { includeResult: true });
  const numeric = Number(record?.inGameTimestamp);
  return Number.isFinite(numeric) ? numeric : null;
}

export function isRecordVisibleThroughIGT(store, record, viewerIGT = Infinity) {
  const limit = Number(viewerIGT);
  if (!Number.isFinite(limit)) return true;
  const visibleAt = getRecordVisibilityIGT(store, record);
  return visibleAt == null || visibleAt <= Math.max(0, limit);
}
