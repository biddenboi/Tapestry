import { STORES } from '../constants.js';
import {
  DEFAULT_WORKSPACE_ID,
  withWorkspacePlanningScope,
} from '../planning/WorkspacePlanningScope.js';

function commandId(prefix, entityId) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${entityId}:${suffix}`;
}

function timestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Task commands require a valid timestamp.');
  return date.toISOString();
}

export async function saveTaskCommand(databaseConnection, task, {
  operationId = null,
  origin = 'desktop',
  enqueueSync = true,
  additionalPuts = [],
  additionalDeletes = [],
  at = new Date(),
  label = null,
} = {}) {
  if (!databaseConnection?.commitAtomicMutation || !task?.UUID) {
    throw new TypeError('Saving a task requires the database command facade and a task UUID.');
  }
  const existing = await databaseConnection.get(STORES.todo, task.UUID);
  const occurredAt = timestamp(at);
  const baseVersion = existing?.syncVersion == null ? (existing ? null : 0) : Number(existing.syncVersion);
  const nextVersion = Math.max(
    0,
    Number(existing?.syncVersion) || 0,
    Number(task.syncVersion) || 0,
  ) + 1;
  const next = withWorkspacePlanningScope({
    ...task,
    syncVersion: nextVersion,
    updatedAt: occurredAt,
  }, {
    workspaceId: existing?.workspaceId || task.workspaceId || DEFAULT_WORKSPACE_ID,
    createdByPlayerId: existing?.createdByPlayerId || task.createdByPlayerId || task.parent,
  });
  const commandType = existing ? 'updateTask' : 'createTask';
  const id = operationId || commandId(commandType, next.UUID);
  const commit = await databaseConnection.commitAtomicMutation({
    operationId: id,
    label: label || (existing ? 'task-update' : 'task-create'),
    puts: [
      { store: STORES.todo, record: next },
      ...additionalPuts,
    ],
    deletes: additionalDeletes,
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId: id,
      playerId: next.parent || null,
      workspaceId: next.workspaceId,
      commandType,
      entityType: 'task',
      entityId: next.UUID,
      baseVersion,
      payload: { task: next },
      occurredAt,
    }) || { origin, enqueueSync: false },
  });
  return Object.freeze({ task: next, commit, commandType, operationId: id });
}

export async function deleteTaskCommand(databaseConnection, taskOrId, {
  operationId = null,
  origin = 'desktop',
  enqueueSync = true,
  additionalDeletes = [],
  at = new Date(),
} = {}) {
  const entityId = String(taskOrId?.UUID || taskOrId || '').trim();
  if (!databaseConnection?.commitAtomicMutation || !entityId) {
    throw new TypeError('Deleting a task requires the database command facade and a task UUID.');
  }
  const existing = taskOrId?.UUID ? taskOrId : await databaseConnection.get(STORES.todo, entityId);
  if (!existing) return Object.freeze({ deleted: false, task: null });
  const occurredAt = timestamp(at);
  const id = operationId || commandId('deleteTask', entityId);
  const commit = await databaseConnection.commitAtomicMutation({
    operationId: id,
    label: 'task-delete',
    deletes: [
      { store: STORES.todo, UUID: entityId },
      ...additionalDeletes,
    ],
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId: id,
      playerId: existing.parent || null,
      workspaceId: existing.workspaceId || DEFAULT_WORKSPACE_ID,
      commandType: 'deleteTask',
      entityType: 'task',
      entityId,
      baseVersion: existing.syncVersion == null ? null : Number(existing.syncVersion),
      payload: { taskId: entityId, deletedAt: occurredAt },
      occurredAt,
    }) || { origin, enqueueSync: false },
  });
  return Object.freeze({ deleted: !commit?.duplicate, task: existing, commit, operationId: id });
}
