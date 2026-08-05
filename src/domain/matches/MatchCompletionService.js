import { MATCH_STATUS } from '@domain/constants.js';
import {
  computeLegacyEloChanges,
  computePairMatchEloChanges,
} from '@domain/matches/Elo.js';
import {
  getMatchTeams,
  isPairMatch,
  withImmutableMatchSnapshots,
} from '@domain/matches/MatchContracts.js';
import { getRankGroupFloor } from '@domain/rank/Rank.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { isRatedMatch, matchRatingMode, MATCH_RATING_MODE } from '@domain/matches/RatingMode.js';
import { createRewardProvenance } from '@domain/rewards/RewardProvenance.js';
import { createWorldConsequenceReceipt } from '@domain/world-consequences/WorldConsequencePolicy.js';
import { saveMatchStateCommand } from './MatchSyncCommands.js';

export const MATCH_POST_PROCESSING_VERSION = 1;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function compactTaskPoints(task) {
  const base = Number(task?.pointsBase);
  const legacy = Number(task?.points);
  const value = Number.isFinite(base) && (base > 0 || !Number.isFinite(legacy) || legacy === 0)
    ? base
    : legacy;
  return Math.max(0, Math.floor(finite(value)));
}

function compactTask(task) {
  return {
    UUID: task?.UUID || null,
    parent: task?.parent || null,
    name: task?.name || null,
    points: compactTaskPoints(task),
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
    points: Math.max(0, Math.floor(finite(event?.points))),
    taskName: event?.taskName || null,
    matchElapsedMs: event?.matchElapsedMs == null
      ? null
      : finite(event.matchElapsedMs, null),
    timelineAt: event?.timelineAt || null,
  };
}

function compactMatchRewardBreakdowns(scoreEvents, matchUUID, participantUUID) {
  return (scoreEvents || [])
    .filter((event) => (
      String(event?.matchUUID || '') === String(matchUUID || '')
      && String(event?.participantUUID || '') === String(participantUUID || '')
      && event?.evidence?.matchReward
    ))
    .map((event) => ({
      scoreEventUUID: event.UUID,
      actionSessionUUID: event.actionSessionUUID || null,
      occurredAt: event.occurredAt || null,
      ...event.evidence.matchReward,
      points: Math.max(0, Math.floor(finite(event.points, event.evidence.matchReward.points))),
    }));
}

export function calculateMatchPrimaryResult({
  match,
  currentPlayer,
  finalScores,
  forcedLoss = false,
  concludedAt = new Date().toISOString(),
  concludedInGameTimestamp = null,
  origin = 'desktop',
  eventHistory = [],
  completedTasks = [],
  scoreEvents = [],
} = {}) {
  const canonicalMatch = withImmutableMatchSnapshots(match || {});
  const teams = getMatchTeams(canonicalMatch);
  const canonicalScores = Object.fromEntries(Object.entries(finalScores || {}).map(([UUID, value]) => [
    UUID,
    Math.max(0, Math.floor(finite(value))),
  ]));
  const currentPlayerUUID = String(currentPlayer?.UUID || canonicalMatch.parent || '');
  const currentPlayerTeamIdx = teams.findIndex((team) => (
    (team || []).some((participant) => String(participant?.UUID) === currentPlayerUUID)
  ));
  if (currentPlayerTeamIdx < 0) throw new Error('Current player is not part of the match snapshot.');

  const forcedLoserTeamIdx = forcedLoss ? currentPlayerTeamIdx : null;
  const pairMatch = isPairMatch(canonicalMatch);
  const elo = pairMatch
    ? computePairMatchEloChanges(teams, canonicalScores, forcedLoserTeamIdx)
    : computeLegacyEloChanges(teams, canonicalScores, forcedLoserTeamIdx);
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

  const totalRecordedPoints = Object.values(canonicalScores)
    .reduce((total, value) => total + Math.max(0, finite(value)), 0);
  const minimumValidActivityMs = Math.max(
    0,
    finite(canonicalMatch.rulesSnapshot?.minimumValidActivityMs, 60_000),
  );
  const recordedActivityMs = (completedTasks || [])
    .reduce((total, task) => total + Math.max(
      0,
      new Date(task?.completedAt || 0).getTime() - new Date(task?.createdAt || 0).getTime(),
    ), 0);
  const validForRewards = totalRecordedPoints > 0 || recordedActivityMs >= minimumValidActivityMs;

  const result = {
    winner: elo.winnerTeamIdx == null ? null : elo.winnerTeamIdx + 1,
    team1Total: elo.t1Total,
    team2Total: elo.t2Total,
    playerScores: canonicalScores,
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
      version: pairMatch ? 2 : 1,
      policy: pairMatch ? 'elo-team-average-v1' : 'team-contribution-v1',
      forcedLoserTeamIdx,
    },
    ratingExplanation: pairMatch ? {
      policy: 'elo-team-average-v1',
      teamAverageRatings: elo.teamAverageRatings,
      expectedTeam1: elo.expectedTeam1,
      teamDeltas: elo.teamDeltas,
      individualPointShareAffectsRating: false,
    } : null,
    postProcessingVersion: MATCH_POST_PROCESSING_VERSION,
    validity: {
      validForRewards,
      totalRecordedPoints,
      recordedActivityMs,
      minimumValidActivityMs,
      reason: validForRewards ? 'eligible-life-evidence' : 'insufficient-life-evidence',
    },
    postMatchInput: {
      eventHistory: (eventHistory || []).slice(-120).map(compactEvent),
      completedTasks: (completedTasks || []).map(compactTask),
    },
    matchScoreBreakdowns: compactMatchRewardBreakdowns(
      scoreEvents,
      canonicalMatch.UUID,
      currentPlayerUUID,
    ),
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
  scoreEvents = [],
  concludedAt = new Date().toISOString(),
  concludedInGameTimestamp = null,
  origin = 'desktop',
} = {}) {
  if (!databaseConnection || !match?.UUID || !currentPlayer?.UUID) return null;
  const calculated = calculateMatchPrimaryResult({
    match,
    currentPlayer,
    finalScores,
    forcedLoss,
    eventHistory,
    completedTasks,
    scoreEvents,
    concludedAt,
    concludedInGameTimestamp,
  });
  const pairMatch = isPairMatch(calculated.canonicalMatch);
  const ratingMode = pairMatch
    ? MATCH_RATING_MODE.rated
    : matchRatingMode(calculated.canonicalMatch, MATCH_RATING_MODE.rated);
  const rated = pairMatch
    ? Boolean(calculated.canonicalMatch.lockedAt)
    : isRatedMatch({
        ...calculated.canonicalMatch,
        status: MATCH_STATUS.complete,
        ratingMode,
      }) && (forcedLoss || calculated.result.validity.validForRewards);
  const immediateReward = rated
    ? calculated.immediateReward
    : {
        ...calculated.immediateReward,
        oldElo: Number(currentPlayer.elo || 0),
        newElo: Number(currentPlayer.elo || 0),
        eloChange: 0,
      };
  const recordedResult = rated
    ? calculated.result
    : {
        ...calculated.result,
        oldElo: immediateReward.oldElo,
        newElo: immediateReward.newElo,
        eloChange: 0,
        eloBreakdown: [],
        immediateReward,
      };
  const recordedMatch = {
    ...calculated.canonicalMatch,
    status: MATCH_STATUS.complete,
    phase: pairMatch ? 'recap' : calculated.canonicalMatch.phase,
    ...(pairMatch ? {} : { ratingMode }),
    completedInGameTimestamp: calculated.result.inGameTimestamp,
    result: recordedResult,
  };
  const rewardedPlayer = {
    ...currentPlayer,
    elo: rated ? calculated.immediateReward.newElo : currentPlayer.elo,
  };
  const worldReceipt = calculated.result.validity.validForRewards
    ? createWorldConsequenceReceipt({
        playerUUID: currentPlayer.UUID,
        sourceEventUUID: match.UUID,
        sourceType: 'match-completed',
        consequenceType: 'arena-record',
        payload: {
          rulesetId: calculated.canonicalMatch.rulesSnapshot?.rulesetId,
          legacyMode: calculated.canonicalMatch.rulesSnapshot?.mode || null,
          rated,
          iWon: recordedResult.iWon,
          team1Total: recordedResult.team1Total,
          team2Total: recordedResult.team2Total,
        },
        createdAt: concludedAt,
      })
    : null;
  const eloProvenance = immediateReward.eloChange !== 0
    ? createRewardProvenance({
        playerUUID: currentPlayer.UUID,
        sourceEventUUID: match.UUID,
        sourceType: 'rated-match',
        rewardType: 'elo',
        amount: immediateReward.eloChange,
        explanation: `Rated Match result under ${calculated.canonicalMatch.rulesSnapshot?.ratingPolicy || calculated.canonicalMatch.rulesSnapshot?.eloModel || 'the recorded Elo policy'}.`,
        issuedAt: concludedAt,
      })
    : null;

  const saved = await saveMatchStateCommand(databaseConnection, recordedMatch, {
    commandType: 'completeMatch',
    operationId: `complete-match:${recordedMatch.UUID}`,
    player: rewardedPlayer,
    worldReceipt,
    rewardProvenance: eloProvenance,
    origin,
    label: 'match-primary-completion',
  });

  return {
    match: saved?.match || recordedMatch,
    player: saved?.player || rewardedPlayer,
    result: recordedResult,
    immediateReward,
    worldReceipt,
    eloProvenance,
  };
}

export default completeMatchPrimary;
