import { STORES } from '../../../domain/constants.js';
import {
  DEFAULT_WORKSPACE_ID,
  dedupePlanningRecords,
  isPlanningRecordInWorkspace,
  withWorkspacePlanningScope,
} from '../../../domain/planning/WorkspacePlanningScope.js';

function workspaceDefinitions(records, workspaceId) {
  return dedupePlanningRecords(records)
    .filter((record) => isPlanningRecordInWorkspace(record, workspaceId))
    .map((record) => withWorkspacePlanningScope(record, { workspaceId }));
}

export async function queryMobileWorkspaceAgenda(databaseConnection, {
  workspaceId = DEFAULT_WORKSPACE_ID,
} = {}) {
  if (!databaseConnection?.getAll) {
    throw new TypeError('The mobile workspace agenda requires a database connection.');
  }
  const [todos, reminders, goals] = await Promise.all([
    databaseConnection.getAll(STORES.todo),
    databaseConnection.getWorkspaceReminders?.(workspaceId)
      || databaseConnection.getAll(STORES.reminder),
    databaseConnection.getAll(STORES.project),
  ]);
  return Object.freeze({
    workspaceId,
    tasks: workspaceDefinitions(todos, workspaceId),
    reminders: workspaceDefinitions(reminders, workspaceId),
    goals: workspaceDefinitions(goals, workspaceId),
  });
}

export default queryMobileWorkspaceAgenda;
