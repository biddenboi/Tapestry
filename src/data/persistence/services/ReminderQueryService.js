import { STORES } from '@domain/constants.js';
import { transitionReminderCommand } from '@domain/reminders/ReminderCommands.js';
import {
  DEFAULT_WORKSPACE_ID,
  dedupePlanningRecords,
  isPlanningRecordInWorkspace,
  withWorkspacePlanningScope,
} from '@domain/planning/WorkspacePlanningScope.js';
function facadeBackedService(target, facade) {
  return new Proxy(target, {
    get(service, property, receiver) {
      if (Reflect.has(service, property)) return Reflect.get(service, property, receiver);
      const value = Reflect.get(facade, property, facade);
      return typeof value === 'function' ? value.bind(facade) : value;
    },
    set(service, property, value, receiver) {
      if (Reflect.has(service, property)) return Reflect.set(service, property, value, receiver);
      return Reflect.set(facade, property, value, facade);
    },
  });
}

export class ReminderQueryService {
  constructor(facade) { if (!facade) throw new Error('ReminderQueryService requires a database facade.'); this.facade = facade; return facadeBackedService(this, facade); }

  async getPlayerReminders(playerUUID) {
    if (!playerUUID) return [];
    const reminders = await this.getPlayerStore(STORES.reminder, playerUUID);
    return reminders.sort((a, b) => (
      this._getReminderTime(a) - this._getReminderTime(b)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    ));
  }

  async getWorkspaceReminders(workspaceId = DEFAULT_WORKSPACE_ID) {
    const reminders = await this.getAll(STORES.reminder);
    return dedupePlanningRecords(reminders)
      .filter((reminder) => isPlanningRecordInWorkspace(reminder, workspaceId))
      .map((reminder) => withWorkspacePlanningScope(reminder, { workspaceId }))
      .sort((a, b) => (
        this._getReminderTime(a) - this._getReminderTime(b)
        || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      ));
  }

  _getReminderTime(reminder) {
    const snoozed = new Date(reminder?.snoozedUntil || '').getTime();
    if (Number.isFinite(snoozed)) return snoozed;
    const remindAt = new Date(reminder?.remindAt || '').getTime();
    return Number.isFinite(remindAt) ? remindAt : Infinity;
  }

  async getUpcomingReminders(playerUUID, { limit = 4 } = {}) {
    const reminders = await this.getPlayerReminders(playerUUID);
    return reminders
      .filter((reminder) => !reminder.completedAt && !reminder.dismissedAt)
      .sort((a, b) => this._getReminderTime(a) - this._getReminderTime(b))
      .slice(0, Math.max(1, Number(limit) || 4));
  }

  async getUpcomingWorkspaceReminders(workspaceId = DEFAULT_WORKSPACE_ID, { limit = 4 } = {}) {
    const reminders = await this.getWorkspaceReminders(workspaceId);
    return reminders
      .filter((reminder) => !reminder.completedAt && !reminder.dismissedAt)
      .slice(0, Math.max(1, Number(limit) || 4));
  }

  async getDueReminders(playerUUID, now = new Date()) {
    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(nowMs)) return [];
    const reminders = await this.getPlayerReminders(playerUUID);
    return reminders.filter((reminder) => (
      !reminder.completedAt
      && !reminder.dismissedAt
      && this._getReminderTime(reminder) <= nowMs
    ));
  }

  async _patchReminder(reminderUUID, patch, commandType, options = {}) {
    const reminder = await this.get(STORES.reminder, reminderUUID);
    if (!reminder) return null;
    const result = await transitionReminderCommand(this, reminder, commandType, patch, options);
    return result?.reminder || null;
  }

  completeReminder(reminderUUID, options = {}) {
    return this._patchReminder(reminderUUID, {
      completedAt: new Date().toISOString(),
      dismissedAt: null,
      snoozedUntil: null,
    }, 'completeReminder', options);
  }

  dismissReminder(reminderUUID, options = {}) {
    return this._patchReminder(reminderUUID, {
      dismissedAt: new Date().toISOString(),
    }, 'dismissReminder', options);
  }

  snoozeReminder(reminderUUID, minutes = 10, options = {}) {
    const duration = Math.max(1, Number(minutes) || 10) * 60000;
    return this._patchReminder(reminderUUID, {
      snoozedUntil: new Date(Date.now() + duration).toISOString(),
      dismissedAt: null,
    }, 'snoozeReminder', options);
  }
}
export default ReminderQueryService;
