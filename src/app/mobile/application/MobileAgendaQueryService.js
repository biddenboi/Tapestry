import { STORES } from '../../../domain/constants.js';
import {
  DEFAULT_WORKSPACE_ID,
  dedupePlanningRecords,
  isPlanningRecordInWorkspace,
  withWorkspacePlanningScope,
} from '../../../domain/planning/WorkspacePlanningScope.js';
import { annotateTodos, normalizeTaskDraft } from '../../../domain/tasks/TodoView.js';
import { buildSlopeContext } from '../../../domain/tasks/Tasks.js';

function workspaceDefinitions(records, workspaceId) {
  return dedupePlanningRecords(records)
    .filter((record) => isPlanningRecordInWorkspace(record, workspaceId))
    .map((record) => withWorkspacePlanningScope(record, { workspaceId }));
}

export async function queryMobileWorkspaceAgenda(databaseConnection, {
  workspaceId = DEFAULT_WORKSPACE_ID,
  playerUUID = null,
} = {}) {
  if (!databaseConnection?.getAll) {
    throw new TypeError('The mobile workspace agenda requires a database connection.');
  }
  const [todos, reminders, goals, completedTasks] = await Promise.all([
    databaseConnection.getAll(STORES.todo),
    databaseConnection.getWorkspaceReminders?.(workspaceId)
      || databaseConnection.getAll(STORES.reminder),
    databaseConnection.getAll(STORES.project),
    playerUUID
      ? databaseConnection.getPlayerStore(STORES.task, playerUUID)
      : Promise.resolve([]),
  ]);
  const workspaceGoals = workspaceDefinitions(goals, workspaceId);
  const workspaceTasks = workspaceDefinitions(todos, workspaceId).map(normalizeTaskDraft);
  return Object.freeze({
    workspaceId,
    tasks: annotateTodos(workspaceTasks, workspaceGoals, buildSlopeContext(completedTasks)),
    reminders: workspaceDefinitions(reminders, workspaceId),
    goals: workspaceGoals,
  });
}

export default queryMobileWorkspaceAgenda;
