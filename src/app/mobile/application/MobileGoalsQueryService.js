import { DEFAULT_WORKSPACE_ID } from '../../../domain/planning/WorkspacePlanningScope.js';

export async function queryMobileWorkspaceGoals(databaseConnection, {
  playerUUID,
  viewerIGT = Infinity,
  workspaceId = DEFAULT_WORKSPACE_ID,
  now = new Date(),
} = {}) {
  if (!databaseConnection?.getRepository || !playerUUID) {
    throw new TypeError('The mobile Goal query requires a database connection and active player.');
  }
  const repository = databaseConnection.getRepository('goals');
  if (!repository?.getWorkspaceOverview) {
    throw new Error('The Goal repository does not expose workspace planning queries.');
  }
  return repository.getWorkspaceOverview(playerUUID, viewerIGT, { workspaceId, now });
}

export default queryMobileWorkspaceGoals;
