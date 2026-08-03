import { STORES } from '../constants.js';
import { DEFAULT_WORKSPACE_ID } from '../planning/WorkspacePlanningScope.js';

function commandId(updateUUID) {
  return `recordGoalUpdate:${updateUUID}`;
}

export async function recordGoalUpdateCommand(databaseConnection, { goal, update }, {
  operationId = null,
  origin = 'desktop',
  enqueueSync = true,
} = {}) {
  if (!databaseConnection?.commitAtomicMutation || !goal?.UUID || !update?.UUID) {
    throw new TypeError('Recording a Goal update requires its Goal and append-only update receipt.');
  }
  const id = operationId || commandId(update.UUID);
  const occurredAt = update.createdAt || new Date().toISOString();
  const commit = await databaseConnection.commitAtomicMutation({
    operationId: id,
    label: 'goal-update-post',
    puts: [
      { store: STORES.project, record: goal },
      { store: STORES.goalUpdate, record: update },
    ],
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId: id,
      playerId: update.parent || goal.parent || null,
      workspaceId: goal.workspaceId || update.workspaceId || DEFAULT_WORKSPACE_ID,
      commandType: 'recordGoalUpdate',
      entityType: 'goal-update',
      entityId: update.UUID,
      payload: { goal, update },
      occurredAt,
    }) || { origin, enqueueSync: false },
  });
  return Object.freeze({ goal, update, commit, operationId: id });
}

export default recordGoalUpdateCommand;
