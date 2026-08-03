export const MAX_SCHEDULE_DELAY_MS = 2_147_000_000;

export function getReminderTimestamp(reminder) {
  const snoozed = new Date(reminder?.snoozedUntil || '').getTime();
  if (Number.isFinite(snoozed)) return snoozed;
  const remindAt = new Date(reminder?.remindAt || '').getTime();
  return Number.isFinite(remindAt) ? remindAt : null;
}

export function getNextReminderDeadline(reminders = [], now = Date.now()) {
  const nowMs = Number(now);
  const upcoming = reminders
    .filter((reminder) => !reminder?.completedAt && !reminder?.dismissedAt)
    .map(getReminderTimestamp)
    .filter((value) => Number.isFinite(value) && value > nowMs)
    .sort((left, right) => left - right);
  return upcoming[0] ?? null;
}

export function getNextLocalDayBoundary(now = new Date()) {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) return null;
  const next = new Date(current);
  next.setHours(24, 0, 0, 25);
  return next.getTime();
}

export function getScheduledDelay(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline)) return null;
  return Math.min(MAX_SCHEDULE_DELAY_MS, Math.max(0, deadline - Number(now)));
}
