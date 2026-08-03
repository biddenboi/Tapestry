const toFiniteNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const wholePoints = (value) => Math.max(0, Math.floor(toFiniteNumber(value)));
const taskPoints = (task) => {
  const base = Number(task?.pointsBase);
  const legacy = Number(task?.points);
  return wholePoints(Number.isFinite(base) && (base > 0 || !Number.isFinite(legacy) || legacy === 0)
    ? base
    : legacy);
};

const getPlayerName = (player) => player?.username || player?.name || 'Unknown';

function getAllPlayers(match) {
  return (match?.teams || []).flatMap((team) => Array.isArray(team) ? team : []);
}

function getTeamTotals(match, finalScores = {}) {
  return (match?.teams || [[], []]).map((team) => (
    (Array.isArray(team) ? team : []).reduce((sum, player) => (
      sum + wholePoints(finalScores[player?.UUID])
    ), 0)
  ));
}

function getReplayBiggestCompletion(players, matchCreatedAt) {
  let best = null;
  const matchStart = new Date(matchCreatedAt).getTime();
  players.forEach((player) => {
    (player?.replayTrace?.sessions || []).forEach((session) => {
      const points = wholePoints(session.points);
      if (!best || points > best.points) {
        const endOffset = toFiniteNumber(session.endOffset, null);
        best = {
          playerUUID: player.UUID,
          playerName: getPlayerName(player),
          taskName: session.name || 'task',
          points,
          createdAt: Number.isFinite(matchStart) && endOffset != null
            ? matchStart + endOffset
            : null,
          source: 'replay',
        };
      }
    });
  });
  return best;
}

function getEventBiggestCompletion(events = []) {
  const bigEvents = events.filter((event) => event?.type === 'big_completion');
  if (!bigEvents.length) return null;
  return bigEvents.reduce((best, event) => {
    const points = wholePoints(event.points);
    return !best || points > best.points
      ? {
        playerUUID: event.playerUUID || null,
        playerName: null,
        taskName: event.taskName || null,
        points,
        createdAt: event.createdAt ?? null,
        source: 'event',
      }
      : best;
  }, null);
}

function getTaskBiggestCompletion(tasks = [], playersByUUID = {}) {
  return tasks.reduce((best, task) => {
    const points = taskPoints(task);
    if (points <= toFiniteNumber(best?.points)) return best;
    const player = playersByUUID[task?.parent];
    return {
      playerUUID: task?.parent || null,
      playerName: getPlayerName(player),
      taskName: task?.name || 'task',
      points,
      createdAt: task?.completedAt || task?.createdAt || null,
      source: 'task',
    };
  }, null);
}

function pickBiggestCompletion(candidates = []) {
  return candidates.filter(Boolean).reduce((best, candidate) => (
    !best || toFiniteNumber(candidate.points) > toFiniteNumber(best.points)
      ? candidate
      : best
  ), null);
}

function recordedMatchElapsedMs(event) {
  if (event?.matchElapsedMs == null || event.matchElapsedMs === '') return null;
  const elapsedMs = Number(event?.matchElapsedMs);
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null;
}

function sanitizeNotableEvent(event) {
  return {
    id: event?.id || null,
    type: event?.type || 'match_update',
    severity: event?.severity || 'info',
    message: String(event?.message || ''),
    teamIdx: Number.isInteger(event?.teamIdx) ? event.teamIdx : null,
    playerUUID: event?.playerUUID || null,
    matchElapsedMs: recordedMatchElapsedMs(event),
    timelineAt: event?.timelineAt || null,
  };
}

export function buildMatchHighlights({
  match,
  finalScores = {},
  eventHistory = [],
  currentPlayerUUID,
  completedTasks = [],
}) {
  const players = getAllPlayers(match);
  const playersByUUID = Object.fromEntries(players.map((player) => [player.UUID, player]));
  const teamTotals = getTeamTotals(match, finalScores);
  const mvp = players.reduce((best, player) => {
    const score = wholePoints(finalScores[player.UUID]);
    return !best || score > best.score ? { player, score } : best;
  }, null);
  const currentPlayerScore = wholePoints(finalScores[currentPlayerUUID]);
  const leadChanges = eventHistory.filter((event) => event?.type === 'lead_change').length;
  const eventBiggest = getEventBiggestCompletion(eventHistory);
  const replayBiggest = getReplayBiggestCompletion(players, match?.createdAt);
  const taskBiggest = getTaskBiggestCompletion(completedTasks, playersByUUID);
  const biggestCompletion = pickBiggestCompletion([
    taskBiggest,
    replayBiggest,
    eventBiggest,
  ]);

  const notableEvents = [...eventHistory]
    .filter((event) => event?.message)
    .sort((a, b) => {
      const aElapsed = recordedMatchElapsedMs(a);
      const bElapsed = recordedMatchElapsedMs(b);
      if (aElapsed == null && bElapsed == null) return 0;
      if (aElapsed == null) return 1;
      if (bElapsed == null) return -1;
      return bElapsed - aElapsed;
    })
    .slice(0, 20)
    .map(sanitizeNotableEvent);

  const cards = [
    {
      type: 'mvp',
      label: 'MVP',
      value: mvp?.player ? getPlayerName(mvp.player) : 'No scorer',
      detail: `${Math.max(0, toFiniteNumber(mvp?.score)).toLocaleString()} pts`,
      playerUUID: mvp?.player?.UUID || null,
    },
    {
      type: 'contribution',
      label: 'Your contribution',
      value: `${currentPlayerScore.toLocaleString()} pts`,
      detail: currentPlayerScore > 0 ? 'Recorded during this match.' : 'No completed tasks recorded.',
      playerUUID: currentPlayerUUID || null,
    },
    {
      type: 'final_score',
      label: 'Final score',
      value: `${(teamTotals[0] || 0).toLocaleString()} - ${(teamTotals[1] || 0).toLocaleString()}`,
      detail: Math.abs((teamTotals[0] || 0) - (teamTotals[1] || 0)) <= 100
        ? 'Decided by a narrow margin.'
        : 'Score gap held through the finish.',
      playerUUID: null,
    },
  ];

  if (biggestCompletion?.points > 0) {
    const player = playersByUUID[biggestCompletion.playerUUID];
    cards.push({
      type: 'biggest_completion',
      label: 'Biggest completion',
      value: `+${Math.round(biggestCompletion.points).toLocaleString()}`,
      detail: `${biggestCompletion.playerName || getPlayerName(player)} finished ${biggestCompletion.taskName || 'a task'}.`,
      playerUUID: biggestCompletion.playerUUID || null,
    });
  }

  cards.push({
    type: 'lead_changes',
    label: 'Lead changes',
    value: String(leadChanges),
    detail: leadChanges > 0 ? 'Momentum changed hands during the match.' : 'The leader stayed stable.',
    playerUUID: null,
  });

  return {
    teamTotals,
    mvpUUID: mvp?.player?.UUID || null,
    mvpScore: Math.max(0, toFiniteNumber(mvp?.score)),
    currentPlayerScore,
    leadChanges,
    biggestCompletion,
    notableEvents,
    cards,
  };
}
