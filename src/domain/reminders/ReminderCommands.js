import { STORES } from '../constants.js';
import {
  DEFAULT_WORKSPACE_ID,
  withWorkspacePlanningScope,
} from '../planning/WorkspacePlanningScope.js';

function id(prefix, entityId) {
  return `${prefix}:${entityId}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;
}

export async function saveReminderCommand(databaseConnection, reminder, {
  operationId = null,
  origin = 'desktop',
  enqueueSync = true,
  at = new Date(),
} = {}) {
  if (!databaseConnection?.commitAtomicMutation || !reminder?.UUID) {
    throw new TypeError('Saving a reminder requires the database command facade and a reminder UUID.');
  }
  const existing = await databaseConnection.get(STORES.reminder, reminder.UUID);
  const occurredAt = new Date(at).toISOString();
  const next = withWorkspacePlanningScope({
    ...reminder,
    syncVersion: Math.max(Number(existing?.syncVersion) || 0, Number(reminder.syncVersion) || 0) + 1,
    updatedAt: occurredAt,
  }, {
    workspaceId: existing?.workspaceId || reminder.workspaceId || DEFAULT_WORKSPACE_ID,
    createdByPlayerId: existing?.createdByPlayerId || reminder.createdByPlayerId || reminder.parent,
  });
  const commandType = existing ? 'updateReminder' : 'createReminder';
  const commandId = operationId || id(commandType, next.UUID);
  const commit = await databaseConnection.commitAtomicMutation({
    operationId: commandId,
    label: existing ? 'reminder-update' : 'reminder-create',
    puts: [{ store: STORES.reminder, record: next }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId: commandId,
      playerId: next.parent || null,
      workspaceId: next.workspaceId,
      commandType,
      entityType: 'reminder',
      entityId: next.UUID,
      baseVersion: existing?.syncVersion == null ? (existing ? null : 0) : Number(existing.syncVersion),
      payload: { reminder: next },
      occurredAt,
    }) || { origin, enqueueSync: false },
  });
  return Object.freeze({ reminder: next, commit, commandType, operationId: commandId });
}

export async function transitionReminderCommand(databaseConnection, reminderOrId, commandType, patch, options = {}) {
  if (!['completeReminder', 'dismissReminder', 'snoozeReminder'].includes(commandType)) {
    throw new TypeError(`Unsupported reminder transition: ${commandType}`);
  }
  const reminder = reminderOrId?.UUID
    ? reminderOrId
    : await databaseConnection.get(STORES.reminder, String(reminderOrId || ''));
  if (!reminder) return null;
  const occurredAt = new Date(options.at || new Date()).toISOString();
  const next = withWorkspacePlanningScope({
    ...reminder,
    ...patch,
    syncVersion: Math.max(0, Number(reminder.syncVersion) || 0) + 1,
    updatedAt: occurredAt,
  }, {
    workspaceId: reminder.workspaceId || DEFAULT_WORKSPACE_ID,
    createdByPlayerId: reminder.createdByPlayerId || reminder.parent,
  });
  const operationId = options.operationId || id(commandType, next.UUID);
  const commit = await databaseConnection.commitAtomicMutation({
    operationId,
    label: commandType,
    puts: [{ store: STORES.reminder, record: next }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin: options.origin || 'desktop',
      enqueueSync: options.enqueueSync !== false,
      operationId,
      playerId: next.parent || null,
      workspaceId: next.workspaceId,
      commandType,
      entityType: 'reminder',
      entityId: next.UUID,
      baseVersion: reminder.syncVersion == null ? null : Number(reminder.syncVersion),
      payload: { reminder: next },
      occurredAt,
    }) || { origin: options.origin || 'desktop', enqueueSync: false },
  });
  return Object.freeze({ reminder: next, commit, commandType, operationId });
}

export async function deleteReminderCommand(databaseConnection, reminderOrId, options = {}) {
  const reminder = reminderOrId?.UUID
    ? reminderOrId
    : await databaseConnection.get(STORES.reminder, String(reminderOrId || ''));
  if (!reminder) return null;
  const occurredAt = new Date(options.at || new Date()).toISOString();
  const operationId = options.operationId || id('deleteReminder', reminder.UUID);
  const commit = await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'reminder-delete',
    deletes: [{ store: STORES.reminder, UUID: reminder.UUID }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin: options.origin || 'desktop',
      enqueueSync: options.enqueueSync !== false,
      operationId,
      playerId: reminder.parent || null,
      workspaceId: reminder.workspaceId || DEFAULT_WORKSPACE_ID,
      commandType: 'deleteReminder',
      entityType: 'reminder',
      entityId: reminder.UUID,
      baseVersion: reminder.syncVersion == null ? null : Number(reminder.syncVersion),
      payload: { reminderId: reminder.UUID, deletedAt: occurredAt },
      occurredAt,
    }) || { origin: options.origin || 'desktop', enqueueSync: false },
  });
  return Object.freeze({ reminder, commit, operationId });
}
