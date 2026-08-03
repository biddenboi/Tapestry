import { v4 as uuid } from 'uuid';
import { STORES } from '../constants.js';

export const ANALYTICS_EVENT_VERSION = 1;

const eventTime = (event = {}) => {
  const parsed = new Date(event.createdAt || '').getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeAnalyticsEvent(event = {}, currentPlayer = null) {
  const parent = event.parent || currentPlayer?.UUID || null;
  const targetUUID = event.targetUUID || event.itemUUID || event.taskUUID || event.journalUUID || null;
  return {
    UUID: event.UUID || uuid(),
    version: ANALYTICS_EVENT_VERSION,
    parent,
    eventName: String(event.eventName || '').trim(),
    surface: String(event.surface || 'app'),
    targetType: event.targetType ? String(event.targetType) : null,
    targetUUID: targetUUID ? String(targetUUID) : null,
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : null,
    createdAt: event.createdAt || new Date().toISOString(),
  };
}

function isDuplicateEvent(left = {}, right = {}, windowMs = 0) {
  if (!windowMs) return false;
  return left.eventName === right.eventName
    && left.surface === right.surface
    && left.targetType === right.targetType
    && left.targetUUID === right.targetUUID
    && Math.abs(eventTime(left) - eventTime(right)) <= windowMs;
}

export async function recordAnalyticsEvent(databaseConnection, currentPlayer, event = {}, options = {}) {
  if (!databaseConnection) return null;
  const normalized = normalizeAnalyticsEvent(event, currentPlayer);
  if (!normalized.parent || !normalized.eventName) return null;

  const dedupeWindowMs = Math.max(0, Number(options.dedupeWindowMs) || 0);
  if (dedupeWindowMs && databaseConnection.getPlayerStore) {
    const existing = await databaseConnection.getPlayerStore(STORES.analyticsEvent, normalized.parent)
      .catch(() => []);
    const duplicate = existing.find((row) => isDuplicateEvent(row, normalized, dedupeWindowMs));
    if (duplicate) return duplicate;
  }

  await databaseConnection.add(STORES.analyticsEvent, normalized);
  return normalized;
}
