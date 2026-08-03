import { STORES } from '@domain/constants.js';

const MATCH_SYNC_TYPES = new Set(['createMatch', 'updateMatch', 'completeMatch']);

export async function saveMatchStateCommand(databaseConnection, match, {
  commandType = 'updateMatch',
  operationId = null,
  player = null,
  worldReceipt = null,
  rewardProvenance = null,
  origin = 'desktop',
  enqueueSync = true,
  label = 'match-state-update',
} = {}) {
  if (!databaseConnection?.commitAtomicMutation || !match?.UUID) {
    throw new TypeError('Saving Match state requires a database connection and Match record.');
  }
  if (!MATCH_SYNC_TYPES.has(commandType)) {
    throw new TypeError(`Unsupported Match sync command: ${commandType}`);
  }
  const timestamp = match.updatedAt || match.result?.concludedAt || new Date().toISOString();
  const stableOperationId = operationId || `${commandType}:${match.UUID}:${timestamp}`;
  const payload = {
    match,
    ...(player?.UUID ? { player } : {}),
    ...(worldReceipt?.UUID ? { worldReceipt } : {}),
    ...(rewardProvenance?.UUID ? { rewardProvenance } : {}),
  };
  return databaseConnection.commitAtomicMutation({
    operationId: stableOperationId,
    label,
    puts: [
      { store: STORES.match, record: match },
      player?.UUID ? { store: STORES.player, record: player } : null,
      worldReceipt?.UUID ? { store: STORES.worldConsequenceReceipt, record: worldReceipt } : null,
      rewardProvenance?.UUID ? { store: STORES.rewardProvenance, record: rewardProvenance } : null,
    ].filter(Boolean),
    flush: commandType === 'completeMatch',
    queueDerived: commandType !== 'completeMatch',
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId: stableOperationId,
      playerId: match.participantProfileId || match.parent || player?.UUID || null,
      commandType,
      entityType: 'match',
      entityId: match.UUID,
      payload,
      occurredAt: timestamp,
    }) || { origin, enqueueSync: false },
  });
}

export async function patchMatchStateCommand(databaseConnection, match, patch, options = {}) {
  const updated = { ...match, ...patch, updatedAt: options.at || new Date().toISOString() };
  await saveMatchStateCommand(databaseConnection, updated, options);
  return updated;
}

export default saveMatchStateCommand;
