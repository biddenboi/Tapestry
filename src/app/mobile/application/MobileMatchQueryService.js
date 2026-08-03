import { STORES } from '../../../domain/constants.js';
import { getMatchTeams } from '../../../domain/matches/MatchContracts.js';

const RESUMABLE_MATCH_STATUSES = new Set(['pending', 'active']);

export function profileParticipatesInMatch(match, playerUUID) {
  const id = String(playerUUID || '');
  if (!id || !match) return false;
  if (String(match.participantProfileId || match.parent || '') === id) return true;
  return getMatchTeams(match).flat().some((player) => String(player?.UUID || '') === id);
}

export async function queryResumableMobileMatch(databaseConnection, { playerUUID } = {}) {
  if (!databaseConnection?.getAll || !playerUUID) return null;
  const matches = await databaseConnection.getAll(STORES.match);
  return (matches || [])
    .filter((match) => RESUMABLE_MATCH_STATUSES.has(String(match?.status || '')))
    .filter((match) => profileParticipatesInMatch(match, playerUUID))
    .sort((left, right) => (
      (right.status === 'active') - (left.status === 'active')
      || String(right.updatedAt || right.lockedAt || right.createdAt || '')
        .localeCompare(String(left.updatedAt || left.lockedAt || left.createdAt || ''))
    ))[0] || null;
}

export default queryResumableMobileMatch;
