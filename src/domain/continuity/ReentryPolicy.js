import { STORES } from '@domain/constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function occurredAt(record) {
  return new Date(record?.endedAt || record?.updatedAt || record?.createdAt || 0).getTime();
}

export function absenceDurationMs(records = [], now = Date.now()) {
  const latest = records.reduce((value, record) => Math.max(value, occurredAt(record)), 0);
  return latest > 0 ? Math.max(0, Number(now) - latest) : 0;
}

export function shouldShowReentry(records = [], now = Date.now(), thresholdMs = 2 * DAY_MS) {
  return absenceDurationMs(records, now) >= thresholdMs;
}

export async function reconcileReentryState(databaseConnection, playerUUID, now = new Date()) {
  const [sessions, opportunities, reminders, todos] = await Promise.all([
    databaseConnection.getPlayerStore(STORES.actionSession, playerUUID),
    databaseConnection.getPlayerStore(STORES.rhythmOpportunity, playerUUID),
    databaseConnection.getPlayerStore(STORES.reminder, playerUUID),
    databaseConnection.getAll(STORES.todo),
  ]);
  const ownedTodos = todos.filter((todo) => (
    !todo.parent || String(todo.parent) === String(playerUUID)
  ));
  const timestamp = now.toISOString();
  const expiredOpportunities = opportunities.filter((row) => (
    row.status === 'pending'
    && new Date(row.windowEnd).getTime() < now.getTime()
  ));
  const obsoleteReminders = reminders.filter((row) => (
    !row.completedAt
    && !row.dismissedAt
    && new Date(row.snoozedUntil || row.remindAt || Infinity).getTime() < now.getTime() - DAY_MS
    && row.repeat !== true
  ));
  if (expiredOpportunities.length || obsoleteReminders.length) {
    await databaseConnection.commitAtomicMutation({
      label: 'continuity-reentry-reconcile-stale-context',
      puts: [
        ...expiredOpportunities.map((row) => ({
          store: STORES.rhythmOpportunity,
          record: {
            ...row,
            status: 'expired',
            resolutionReason: 'window-ended',
            resolvedAt: timestamp,
            updatedAt: timestamp,
          },
        })),
        ...obsoleteReminders.map((row) => ({
          store: STORES.reminder,
          record: {
            ...row,
            dismissedAt: timestamp,
            dismissalReason: 'obsolete-after-absence',
            updatedAt: timestamp,
          },
        })),
      ],
    });
  }
  const continuityRecords = sessions.length ? sessions : ownedTodos;
  return Object.freeze({
    extendedAbsence: shouldShowReentry(continuityRecords, now.getTime()),
    absenceMs: absenceDurationMs(continuityRecords, now.getTime()),
    expiredRoutineCount: expiredOpportunities.length,
    obsoleteReminderCount: obsoleteReminders.length,
    openTasks: ownedTodos.filter((todo) => !todo.completedAt),
    lastSession: [...sessions].sort((a, b) => occurredAt(b) - occurredAt(a))[0] || null,
  });
}
