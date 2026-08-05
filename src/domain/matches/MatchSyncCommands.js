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
  const timestamp = commandType === 'completeMatch'
    ? match.result?.concludedAt || match.updatedAt || new Date().toISOString()
    : match.updatedAt || new Date().toISOString();
  const synchronizedMatch = {
    ...match,
    updatedAt: timestamp,
    syncUpdatedAt: timestamp,
  };
  const synchronizedPlayer = player?.UUID ? {
    ...player,
    updatedAt: timestamp,
    syncUpdatedAt: timestamp,
  } : null;
  const stableOperationId = operationId || `${commandType}:${match.UUID}:${timestamp}`;
  const payload = {
    match: synchronizedMatch,
    ...(synchronizedPlayer ? { player: synchronizedPlayer } : {}),
    ...(worldReceipt?.UUID ? { worldReceipt } : {}),
    ...(rewardProvenance?.UUID ? { rewardProvenance } : {}),
  };
  const commit = await databaseConnection.commitAtomicMutation({
    operationId: stableOperationId,
    label,
    puts: [
      { store: STORES.match, record: synchronizedMatch },
      synchronizedPlayer ? { store: STORES.player, record: synchronizedPlayer } : null,
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
  return { ...(commit || {}), match: synchronizedMatch, player: synchronizedPlayer };
}

export async function patchMatchStateCommand(databaseConnection, match, patch, options = {}) {
  const updatedAt = options.at || new Date().toISOString();
  const updated = { ...match, ...patch, updatedAt, syncUpdatedAt: updatedAt };
  const saved = await saveMatchStateCommand(databaseConnection, updated, options);
  return saved.match;
}

export default saveMatchStateCommand;
