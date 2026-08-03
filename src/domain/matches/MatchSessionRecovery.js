const RESUMABLE_MATCH_STATUSES = new Set([
  'pending',
  'active',
]);

export function isPlayerInMatch(match, playerUUID) {
  if (!match || !playerUUID) return false;
  const playerId = String(playerUUID);
  const participantUUIDs = Array.isArray(match.participantUUIDs)
    ? match.participantUUIDs
    : (match.teams || []).flat().map((participant) => participant?.UUID);
  return participantUUIDs.some((participantUUID) => String(participantUUID || '') === playerId);
}

export function isRestorableMatchSession({ actionSession, match, playerUUID }) {
  if (
    !actionSession?.matchUUID
    || actionSession.outcome !== 'active'
    || String(actionSession.playerUUID || actionSession.parent || '') !== String(playerUUID || '')
    || String(match?.UUID || '') !== String(actionSession.matchUUID)
    || !RESUMABLE_MATCH_STATUSES.has(match?.status)
  ) return false;
  return isPlayerInMatch(match, playerUUID);
}

export async function resolveRestorableMatchSession(databaseConnection, {
  actionSession,
  playerUUID,
}) {
  if (!actionSession?.matchUUID || !playerUUID) return null;
  const match = await databaseConnection.get('matches', actionSession.matchUUID);
  return isRestorableMatchSession({ actionSession, match, playerUUID }) ? match : null;
}
