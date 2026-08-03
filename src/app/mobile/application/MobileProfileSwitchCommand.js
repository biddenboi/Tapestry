import { GAME_STATE, STORES } from '../../../domain/constants.js';
import { DATA_DOMAIN, DOMAIN_INVALIDATION } from '../../context/domainRevisions.js';

export const MOBILE_PROFILE_SWITCH_INVALIDATION = Object.freeze([
  ...new Set([
    ...DOMAIN_INVALIDATION.profileWrite,
    DATA_DOMAIN.inventory,
    DATA_DOMAIN.shop,
    DATA_DOMAIN.matches,
    DATA_DOMAIN.events,
    DATA_DOMAIN.eventBuffs,
    DATA_DOMAIN.social,
  ]),
]);

function switchError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function activePinnedSession(databaseConnection, currentPlayerUUID) {
  if (!currentPlayerUUID) return null;
  const sessions = await databaseConnection.getPlayerStore(STORES.actionSession, currentPlayerUUID)
    .catch(() => []);
  return sessions.find((session) => session?.outcome === 'active' && !session.endedAt) || null;
}

export async function switchMobileProfile({
  databaseConnection,
  currentPlayer,
  targetPlayerUUID,
  gameState = GAME_STATE.idle,
  updateCurrentPlayer = null,
  invalidateDomains = null,
  notify = null,
  boundaryAuthorized = false,
} = {}) {
  const currentId = String(currentPlayer?.UUID || '').trim();
  const targetId = String(targetPlayerUUID || '').trim();
  if (!databaseConnection || !currentId || !targetId) {
    throw switchError('mobile-profile-switch-invalid', 'Choose an available profile.');
  }
  if (!boundaryAuthorized) {
    throw switchError(
      'mobile-profile-switch-boundary-required',
      'Profiles can only be changed during Start Day or End Day.',
    );
  }
  const profiles = await databaseConnection.getAllPlayers({
    includeArchived: false,
    includeBanned: false,
  });
  const target = profiles.find((profile) => String(profile.UUID) === targetId);
  if (!target || target.archivedAt || target.bannedAt) {
    throw switchError('mobile-profile-switch-forbidden', 'That profile is not available in this workspace.');
  }
  if (currentId === targetId) {
    return Object.freeze({ changed: false, player: currentPlayer, invalidatedDomains: [] });
  }

  const pinnedSession = await activePinnedSession(databaseConnection, currentId);
  if (pinnedSession || [GAME_STATE.match, GAME_STATE.dojo].includes(gameState)) {
    throw switchError(
      'mobile-profile-switch-session-active',
      'Finish or leave the active work session before switching profiles.',
    );
  }

  const switched = await databaseConnection.switchProfile(currentPlayer, targetId);
  if (!switched) {
    throw switchError('mobile-profile-switch-failed', 'The profile could not be activated.');
  }
  const activated = await databaseConnection.getCurrentPlayer();
  if (!activated || String(activated.UUID) !== targetId) {
    throw switchError('mobile-profile-switch-verification-failed', 'The profile switch was not saved.');
  }
  updateCurrentPlayer?.(activated);
  invalidateDomains?.(MOBILE_PROFILE_SWITCH_INVALIDATION);
  databaseConnection.syncRuntime?.scheduleSync?.('mobile-profile-switch');
  notify?.({
    title: 'Profile switched',
    message: `${activated.username || activated.name || 'Profile'} is now active.`,
    kind: 'success',
    persist: false,
  });
  return Object.freeze({
    changed: true,
    player: activated,
    invalidatedDomains: MOBILE_PROFILE_SWITCH_INVALIDATION,
  });
}

export default switchMobileProfile;
