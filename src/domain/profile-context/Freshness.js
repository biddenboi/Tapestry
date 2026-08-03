import { CONTEXT_STATUS } from './Contracts.js';

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_CONTEXT_TTL_HOURS = Object.freeze({
  now: 24,
  near: 72,
  recent: 168,
  chapter: 720,
  'show-up': 168,
  goal: 336,
  availability: 24,
});

export function defaultContextExpiry(type, now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  const hours = DEFAULT_CONTEXT_TTL_HOURS[type] || 72;
  return new Date(base.getTime() + (hours * HOUR_MS)).toISOString();
}

export function contextFreshness(item, { asOf = new Date(), asOfIGT = 0 } = {}) {
  if (!item || item.status !== CONTEXT_STATUS.active) {
    return Object.freeze({ fresh: false, reason: item?.status || 'missing' });
  }
  const nowMs = (asOf instanceof Date ? asOf : new Date(asOf)).getTime();
  const cursor = Math.max(0, Number(asOfIGT) || 0);
  if (item.inGameTimestamp != null && Number(item.inGameTimestamp) > cursor) {
    return Object.freeze({ fresh: false, reason: 'future-igt' });
  }
  const expiresMs = item.expiresAt ? new Date(item.expiresAt).getTime() : Number.NaN;
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    return Object.freeze({ fresh: false, reason: 'expired-time' });
  }
  if (item.expiresIGT != null && Number(item.expiresIGT) <= cursor) {
    return Object.freeze({ fresh: false, reason: 'expired-igt' });
  }
  if (item.sourceDeletedAt) {
    return Object.freeze({ fresh: false, reason: 'source-deleted' });
  }
  return Object.freeze({
    fresh: true,
    reason: 'current',
    expiresAt: item.expiresAt || null,
    expiresIGT: item.expiresIGT ?? null,
  });
}
