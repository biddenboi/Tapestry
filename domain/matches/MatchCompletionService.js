import { MATCH_STATUS, STORES } from '@domain/constants.js';
import { computeEloChanges } from '@domain/matches/Elo.js';
import { getMatchTeams, withImmutableMatchSnapshots } from '@domain/matches/MatchContracts.js';
import { getRankGroupFloor } from '@domain/rank/Rank.js';
import { getCurrentIGT } from '@domain/time/Time.js';

export const MATCH_POST_PROCESSING_VERSION = 1;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function compactTask(task) {
  return {
    UUID: task?.UUID || null,
    parent: task?.parent || null,
    name: task?.name || null,
    points: finite(task?.points),
    createdAt: task?.createdAt || null,
    completedAt: task?.completedAt || null,
  };
}

function compactEvent(event) {
  return {
    id: event?.id || null,
    type: event?.type || null,
    severity: event?.severity || null,
    message: event?.message || null,
    playerUUID: event?.playerUUID || null,
    teamIdx: event?.teamIdx ?? null,
    points: finite(event?.points),
    taskName: event?.taskName || null,
    matchElapsedMs: finite(event?.matchElapsedMs),
    timelineAt: event?.timelineAt || null,
  };
}

export function calculateMatchPrimaryResult({
  match,
  currentPlayer,
  finalScores,
  forcedLoss = false,
  concludedAt = new Date().toISOString(),
  concludedInGameTimestamp = null,
  eventHistory = [],
  completedTasks = [],
} = {}) {
  const canonicalMatch = withImmutableMatchSnapshots(match || {});
  const teams = getMatchTeams(canonicalMatch);
  const currentPlayerUUID = String(currentPlayer?.UUID || canonicalMatch.parent || '');
  const currentPlayerTeamIdx = teams.findIndex((team) => (
    (team || []).some((participant) => String(participant?.UUID) === currentPlayerUUID)
  ));
  if (currentPlayerTeamIdx < 0) throw new Error('Current player is not part of the match snapshot.');

  const forcedLoserTeamIdx = forcedLoss ? currentPlayerTeamIdx : null;
  const elo = computeEloChanges(teams, finalScores, forcedLoserTeamIdx);
  const rawViewerChange = elo.changes[currentPlayerUUID] || { change: 0, breakdown: [] };
  const snapshotViewer = teams.flat().find((participant) => String(participant.UUID) === currentPlayerUUID);
  const oldElo = Math.max(0, finite(snapshotViewer?.elo, currentPlayer?.elo));
  const newElo = Math.max(getRankGroupFloor(oldElo), oldElo + finite(rawViewerChange.change));
  const eloChange = newElo - oldElo;
  const iWon = currentPlayerTeamIdx === elo.winnerTeamIdx;
  const viewerTeamScore = currentPlayerTeamIdx === 0 ? elo.t1Total : elo.t2Total;
  const opponentTeamScore = currentPlayerTeamIdx === 0 ? elo.t2Total : elo.t1Total;
  const completedIGT = concludedInGameTimestamp == null
    ? getCurrentIGT(currentPlayer)
    : Math.max(0, finite(concludedInGameTimestamp));

  const result = {
    winner: elo.winnerTeamIdx + 1,
    team1Total: elo.t1Total,
    team2Total: elo.t2Total,
    playerScores: { ...(finalScores || {}) },
    iWon,
    wasForfeited: !!forcedLoss,
    forfeitingTeamIdx: forcedLoss ? currentPlayerTeamIdx : null,
    concludedAt,
    inGameTimestamp: completedIGT,
    oldElo,
    newElo,
    eloChange,
    eloBreakdown: rawViewerChange.breakdown || [],
    immediateReward: {
      playerUUID: currentPlayerUUID,
      oldElo,
      newElo,
      eloChange,
      scoreDelta: Math.round(viewerTeamScore - opponentTeamScore),
    },
    eloInput: {
      version: 1,
      forcedLoserTeamIdx,
    },
    postProcessingVersion: MATCH_POST_PROCESSING_VERSION,
    postMatchInput: {
      eventHistory: (eventHistory || []).slice(-120).map(compactEvent),
      completedTasks: (completedTasks || []).map(compactTask),
    },
  };

  return {
    canonicalMatch,
    teams,
    result,
    immediateReward: result.immediateReward,
    viewerChange: {
      ...rawViewerChange,
      oldElo,
      newElo,
      change: eloChange,
    },
  };
}

/**
 * Commit only the authoritative result and the current player's immediate ELO
 * reward. All derived systems are intentionally excluded from this transaction.
 */
export async function completeMatchPrimary({
  databaseConnection,
  match,
  currentPlayer,
  finalScores,
  forcedLoss = false,
  eventHistory = [],
  completedTasks = [],
  concludedAt = new Date().toISOString(),
  concludedInGameTimestamp = null,
} = {}) {
  if (!databaseConnection || !match?.UUID || !currentPlayer?.UUID) return null;
  const calculated = calculateMatchPrimaryResult({
    match,
    currentPlayer,
    finalScores,
    forcedLoss,
    eventHistory,
    completedTasks,
    concludedAt,
    concludedInGameTimestamp,
  });
  const recordedMatch = {
    ...calculated.canonicalMatch,
    status: MATCH_STATUS.complete,
    completedInGameTimestamp: calculated.result.inGameTimestamp,
    result: calculated.result,
  };
  const rewardedPlayer = {
    ...currentPlayer,
    elo: calculated.immediateReward.newElo,
  };

  await databaseConnection.commitAtomicMutation({
    label: 'match-primary-completion',
    puts: [
      { store: STORES.match, record: recordedMatch },
      { store: STORES.player, record: rewardedPlayer },
    ],
    flush: false,
    queueDerived: false,
  });

  return {
    match: recordedMatch,
    player: rewardedPlayer,
    result: calculated.result,
    immediateReward: calculated.immediateReward,
  };
}

export default completeMatchPrimary;
