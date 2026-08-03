import { getPlayerActivityState } from '@domain/matches/MatchActivity.js';
import { getMatchDurationMs } from '@domain/matches/MatchContracts.js';

const ACTIVE_STATUSES = new Set(['active', 'deep_focus', 'charging']);

const toFiniteNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const plural = (count, single, many = `${single}s`) => (
  Number(count) === 1 ? single : many
);

function getMatchPhase(elapsedMs, durationMs) {
  const ratio = durationMs > 0 ? clamp(elapsedMs / durationMs) : 0;
  if (ratio < 0.22) return 'opening';
  if (ratio >= 0.82) return 'endgame';
  return 'midgame';
}

function getCloseness(scoreGap, highestTotal) {
  const closeAt = Math.max(90, highestTotal * 0.08);
  const competitiveAt = Math.max(220, highestTotal * 0.2);
  if (scoreGap <= closeAt) return 'close';
  if (scoreGap <= competitiveAt) return 'competitive';
  return 'decisive';
}

function buildTeamActivity(team, scores, playerStatesByUUID) {
  let activeCount = 0;
  let idleCount = 0;
  let recentCompleteCount = 0;
  let pendingPoints = 0;
  let nextCompletionMs = null;
  let topScorerUUID = null;
  let topScore = -Infinity;

  for (const player of team) {
    const uuid = player?.UUID;
    if (!uuid) continue;
    const activity = playerStatesByUUID[uuid];
    const score = toFiniteNumber(scores[uuid]);

    if (score > topScore) {
      topScore = score;
      topScorerUUID = uuid;
    }

    if (ACTIVE_STATUSES.has(activity?.status)) activeCount += 1;
    else idleCount += 1;
    if (activity?.status === 'recent_complete') recentCompleteCount += 1;

    const activityPending = Math.max(0, Math.round(toFiniteNumber(activity?.pendingPoints)));
    pendingPoints += activityPending;

    const eta = Number(activity?.timeToCompletionMs);
    if (
      activityPending > 0
      && Number.isFinite(eta)
      && eta >= 0
      && (nextCompletionMs == null || eta < nextCompletionMs)
    ) {
      nextCompletionMs = eta;
    }
  }

  return {
    activeCount,
    idleCount,
    recentCompleteCount,
    pendingPoints,
    nextCompletionMs,
    topScorerUUID,
  };
}

function getSummary({
  teamTotals,
  currentPlayerTeamIdx,
  teamActivity,
  closeness,
  phase,
  scoreGap,
  leaderTeamIdx,
}) {
  const myIdx = currentPlayerTeamIdx >= 0 ? currentPlayerTeamIdx : 0;
  const enemyIdx = myIdx === 0 ? 1 : 0;
  const myTotal = teamTotals[myIdx] || 0;
  const enemyTotal = teamTotals[enemyIdx] || 0;
  const myActivity = teamActivity[myIdx] || {};
  const enemyActivity = teamActivity[enemyIdx] || {};
  const enemyHasNext = enemyActivity.nextCompletionMs != null
    && (myActivity.nextCompletionMs == null || enemyActivity.nextCompletionMs < myActivity.nextCompletionMs);
  const myHasNext = myActivity.nextCompletionMs != null
    && (enemyActivity.nextCompletionMs == null || myActivity.nextCompletionMs <= enemyActivity.nextCompletionMs);
  const activePhrase = `${myActivity.activeCount || 0} ${plural(myActivity.activeCount || 0, 'teammate')} active`;
  const enemyPhrase = `${enemyActivity.activeCount || 0} ${plural(enemyActivity.activeCount || 0, 'opponent')} active`;

  if (leaderTeamIdx == null) {
    return {
      title: 'Dead even',
      message: phase === 'endgame'
        ? 'Final stretch. One completion can decide this.'
        : `${activePhrase}. ${enemyPhrase}.`,
    };
  }

  if (myTotal >= enemyTotal) {
    const title = closeness === 'close' ? 'Narrow lead' : closeness === 'competitive' ? 'Contested lead' : 'Commanding lead';
    const pressure = enemyHasNext
      ? 'Opposition has the next projected completion.'
      : myHasNext
        ? 'Your side has the next projected completion.'
        : `${enemyPhrase}.`;
    return {
      title,
      message: `Your team leads by ${scoreGap.toLocaleString()}. ${pressure}`,
    };
  }

  const title = closeness === 'close' ? 'Within striking range' : closeness === 'competitive' ? 'Chasing' : 'Danger zone';
  const support = myActivity.activeCount > 0
    ? `${activePhrase}.`
    : 'Your team is quiet right now.';
  return {
    title,
    message: `Behind by ${scoreGap.toLocaleString()}. ${support}`,
  };
}

export function buildMatchSnapshot({
  match,
  teams,
  scores = {},
  currentPlayerUUID,
  elapsedMs = 0,
  remainingMs = 0,
  activeTask = null,
  previousSnapshot = null,
  now = Date.now(),
}) {
  const sourceTeams = Array.isArray(teams) ? teams : match?.teams;
  const safeTeams = (sourceTeams || [[], []]).map((team) => Array.isArray(team) ? team : []);
  const durationMs = Math.max(1, getMatchDurationMs(match));
  const matchCreatedAtMs = new Date(match?.lockedAt || match?.createdAt || 0).getTime();
  const safeElapsedMs = clamp(toFiniteNumber(elapsedMs), 0, durationMs);
  const safeRemainingMs = Math.max(0, toFiniteNumber(remainingMs, durationMs - safeElapsedMs));
  const previousScores = previousSnapshot?.scoresByUUID || {};
  const playerStatesByUUID = {};
  const playersByUUID = {};
  const playerTeamIdxByUUID = {};

  safeTeams.forEach((team, teamIdx) => {
    team.forEach((player) => {
      if (!player?.UUID) return;
      playersByUUID[player.UUID] = player;
      playerTeamIdxByUUID[player.UUID] = teamIdx;
      playerStatesByUUID[player.UUID] = getPlayerActivityState(player, {
        elapsedMs: safeElapsedMs,
        durationMs,
        isCurrentPlayer: String(player.UUID) === String(currentPlayerUUID),
        activeTask,
        currentScore: toFiniteNumber(scores[player.UUID]),
        previousScore: toFiniteNumber(previousScores[player.UUID], toFiniteNumber(scores[player.UUID])),
        now,
      });
    });
  });

  const teamTotals = safeTeams.map((team) => team.reduce((sum, player) => (
    sum + toFiniteNumber(scores[player?.UUID])
  ), 0));
  while (teamTotals.length < 2) teamTotals.push(0);

  const scoreDelta = teamTotals[0] - teamTotals[1];
  const scoreGap = Math.abs(scoreDelta);
  const leaderTeamIdx = scoreDelta === 0 ? null : scoreDelta > 0 ? 0 : 1;
  const currentPlayerTeamIdx = safeTeams.findIndex((team) => team.some((player) => (
    String(player?.UUID) === String(currentPlayerUUID)
  )));
  const currentPlayerOpponentTeamIdx = currentPlayerTeamIdx === 0 ? 1 : 0;
  const closeness = getCloseness(scoreGap, Math.max(teamTotals[0], teamTotals[1]));
  const phase = getMatchPhase(safeElapsedMs, durationMs);
  const teamActivity = safeTeams.map((team) => buildTeamActivity(team, scores, playerStatesByUUID));
  while (teamActivity.length < 2) teamActivity.push(buildTeamActivity([], scores, playerStatesByUUID));

  const projectedTotals = teamTotals.map((total, idx) => (
    total + Math.round(toFiniteNumber(teamActivity[idx]?.pendingPoints))
  ));
  const scoreDeltasByTeam = teamTotals.map((total, idx) => (
    total - toFiniteNumber(previousSnapshot?.teamTotals?.[idx], total)
  ));

  let mvpUUID = null;
  let mvpScore = -Infinity;
  Object.keys(playersByUUID).forEach((uuid) => {
    const score = toFiniteNumber(scores[uuid]);
    if (score > mvpScore) {
      mvpScore = score;
      mvpUUID = uuid;
    }
  });

  const summary = getSummary({
    teamTotals,
    currentPlayerTeamIdx,
    teamActivity,
    closeness,
    phase,
    scoreGap,
    leaderTeamIdx,
  });

  return {
    elapsedMs: safeElapsedMs,
    remainingMs: safeRemainingMs,
    durationMs,
    matchCreatedAtMs: Number.isFinite(matchCreatedAtMs) ? matchCreatedAtMs : null,
    teamTotals,
    scoreDelta,
    scoreGap,
    leaderTeamIdx,
    currentPlayerTeamIdx,
    currentPlayerOpponentTeamIdx,
    isCurrentPlayerLeading: leaderTeamIdx == null
      ? false
      : leaderTeamIdx === currentPlayerTeamIdx,
    closeness,
    phase,
    playerStatesByUUID,
    teamActivity,
    projectedTotals,
    scoreDeltasByTeam,
    mvpUUID,
    mvpScore: Math.max(0, mvpScore),
    scoresByUUID: { ...scores },
    playersByUUID,
    playerTeamIdxByUUID,
    summary,
  };
}
