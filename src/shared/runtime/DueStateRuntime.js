import { STORES } from '@domain/constants.js';

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isReminderDue(reminder, now = Date.now()) {
  if (!reminder || reminder.completedAt || reminder.dismissedAt || reminder.archivedAt) return false;
  const dueAt = timestamp(reminder.snoozedUntil)
    ?? timestamp(reminder.remindAt)
    ?? timestamp(reminder.dueAt);
  return dueAt != null && dueAt <= Number(now);
}

async function activeRoutineCount(databaseConnection, playerUUID) {
  const client = databaseConnection?.persistenceRuntime?.sqliteStorageAdapter?.client;
  if (!client?.query || !playerUUID) return 0;
  try {
    return Number(await client.query({
      sql: `SELECT COUNT(*) FROM routine_runs
            WHERE player_id=? AND status IN ('active','paused')`,
      bind: [String(playerUUID)],
      result: 'value',
    })) || 0;
  } catch {
    return 0;
  }
}

export async function collectDueState(databaseConnection, playerUUID, now = Date.now()) {
  if (!databaseConnection || !playerUUID) return { count: 0, reminders: [], activeRoutines: 0 };
  const reminders = await databaseConnection.getPlayerStore(STORES.reminder, playerUUID).catch(() => []);
  const dueReminders = reminders.filter((reminder) => isReminderDue(reminder, now));
  const activeRoutines = await activeRoutineCount(databaseConnection, playerUUID);
  return {
    count: dueReminders.length + activeRoutines,
    reminders: dueReminders,
    activeRoutines,
  };
}

export async function refreshDueAppBadge(databaseConnection, playerUUID, now = Date.now()) {
  const due = await collectDueState(databaseConnection, playerUUID, now);
  try {
    if (due.count > 0) await navigator.setAppBadge?.(due.count);
    else await navigator.clearAppBadge?.();
  } catch {
    // Badge support and permission vary by platform; due state remains in-app.
  }
  return due;
}

export default refreshDueAppBadge;
