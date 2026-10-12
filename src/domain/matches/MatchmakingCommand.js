import { v4 as uuid } from 'uuid';
import { MATCH_STATUS, STORES } from '@domain/constants.js';
import { buildGhostRoster } from '@domain/matches/Match.js';
import {
  PAIR_MATCH_RULESET_ID,
  withImmutableMatchSnapshots,
} from '@domain/matches/MatchContracts.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { saveMatchStateCommand } from './MatchSyncCommands.js';

function snapshotPlayer(player, currentPlayer) {
  const active = currentPlayer.activeCosmetics || {};
  return {
    ...player,
    username: currentPlayer.username,
    profilePicture: currentPlayer.profilePicture || null,
    isCurrentPlayer: true,
    cardBanner: active.cardBanner || null,
    playerTheme: active.profileTheme || active.appTheme || active.theme || 'minimalist',
    profileTheme: active.profileTheme || active.appTheme || active.theme || 'minimalist',
    avatarFrame: active.avatarFrame || 'default',
    matchCard: active.matchCard || 'default',
    standingsRow: active.standingsRow || 'default',
    activeTitle: active.title || null,
    frame: active.profileFrame || active.cardFrame || active.frame || null,
    selectedAchievements: currentPlayer.selectedAchievements || [],
  };
}

export async function createPairMatchCommand(databaseConnection, currentPlayer, {
  operationId = uuid(),
  durationHours = 1,
  at = new Date(),
} = {}) {
  if (!databaseConnection || !currentPlayer?.UUID) throw new Error('Matchmaking requires an active local profile.');
  const commandTime = new Date(at);
  if (!Number.isFinite(commandTime.getTime())) throw new Error('Matchmaking requires a valid creation time.');
  const matchUUID = `pair-match:${operationId}`;
  const existing = await databaseConnection.get(STORES.match, matchUUID);
  if (existing) return Object.freeze({ match: existing, duplicate: true, insufficient: false, operationId });

  const matchStartIGT = getCurrentIGT(currentPlayer);
  const players = await databaseConnection.getPlayersAtIGT(matchStartIGT);
  const matchmakingPlayer = players.find((player) => String(player.UUID) === String(currentPlayer.UUID)) || currentPlayer;
  const roster = await buildGhostRoster(databaseConnection, players, matchmakingPlayer, durationHours, { viewerIGT: matchStartIGT });
  if (roster.insufficient) return Object.freeze({
    match: null,
    duplicate: false,
    insufficient: true,
    available: roster.available,
    operationId,
  });

  const createdAt = commandTime.toISOString();
  const teams = [[snapshotPlayer(matchmakingPlayer, currentPlayer), ...roster.teammates], roster.opponents];

  const match = withImmutableMatchSnapshots({
    UUID: matchUUID,
    createdAt,
    rulesetId: PAIR_MATCH_RULESET_ID,
    parent: currentPlayer.UUID,
    participantProfileId: currentPlayer.UUID,
    status: MATCH_STATUS.pending,
    phase: 'team-reveal',
    lockedAt: null,
    inGameTimestamp: matchStartIGT,
    teams,
    result: null,
  });
  const saved = await saveMatchStateCommand(databaseConnection, match, {
    commandType: 'createMatch',
    operationId: `create-match:${operationId}`,
    origin: 'mobile',
    label: 'pair-match-create',
  });
  return Object.freeze({ match: saved?.match || match, duplicate: false, insufficient: false, operationId });
}

export default createPairMatchCommand;
