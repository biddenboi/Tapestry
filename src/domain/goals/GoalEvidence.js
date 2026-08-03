import { STORES } from '../constants.js';
import { recordActionContribution } from '../contribution/Contribution.js';

export async function getGoalLinksForEntity(databaseConnection, entityType, entityUUID) {
  if (!databaseConnection || !entityUUID) return [];
  const links = await databaseConnection.getAll(STORES.goalLink);
  return links.filter((link) => (
    link.entityType === entityType
    && String(link.entityUUID) === String(entityUUID)
    && ['supports', 'next_action'].includes(link.relation)
  ));
}

export async function resolvePrimaryLinkedGoalUUID(databaseConnection, entityType, entityUUID) {
  const links = await getGoalLinksForEntity(databaseConnection, entityType, entityUUID);
  return links[0]?.goalUUID || null;
}

export async function recordLinkedActionContribution(databaseConnection, player, {
  entityType,
  entityUUID,
  source,
  sourceUUID,
  summary,
  createdAt,
  inGameTimestamp,
} = {}) {
  const goalUUID = await resolvePrimaryLinkedGoalUUID(
    databaseConnection,
    entityType,
    entityUUID,
  );
  return recordActionContribution(databaseConnection, player, {
    source,
    sourceUUID,
    summary,
    createdAt,
    inGameTimestamp,
    goalUUID,
  });
}

export function journalLinkCreatesReward() {
  return false;
}

export function milestoneCompletionCreatesReward() {
  return false;
}
