import { STORES } from '@domain/constants.js';
import { buildGhostScoresSync } from '@domain/matches/Match.js';
import { getMatchTeams } from '@domain/matches/MatchContracts.js';
import { reconstructMatchScores } from '@domain/matches/MatchScoring.js';
import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';

function withinMatch(task, match, nowIso) {
  const completedAt = String(task?.completedAt || '');
  return completedAt
    && completedAt >= String(match?.lockedAt || match?.createdAt || '')
    && completedAt <= nowIso;
}

export function buildInMemoryMatchScores({
  match,
  currentPlayerUUID,
  taskHistory = [],
  scoreEvents = [],
  now = Date.now(),
} = {}) {
  if (!match || !currentPlayerUUID) return {};
  const scores = buildGhostScoresSync(match, currentPlayerUUID, now);
  const nowIso = new Date(now).toISOString();
  const audited = (scoreEvents || []).filter((event) => (
    String(event.matchUUID) === String(match.UUID)
    && String(event.participantUUID) === String(currentPlayerUUID)
    && String(event.occurredAt || '') <= nowIso
  ));
  scores[currentPlayerUUID] = audited.length
    ? Number(reconstructMatchScores(audited, match.UUID)[currentPlayerUUID] || 0)
    : (taskHistory || [])
      .filter((task) => String(task?.parent) === String(currentPlayerUUID))
      .filter((task) => withinMatch(task, match, nowIso))
      .reduce((sum, task) => sum + getCanonicalTaskPoints(task), 0);
  return scores;
}

export async function loadMatchRuntimeInput(databaseConnection, match, currentPlayerUUID) {
  if (!databaseConnection || !match || !currentPlayerUUID) {
    return { scores: {}, todos: [], taskHistory: [], scoreEvents: [], teams: [] };
  }
  const [todos, taskHistory, scoreEvents] = await Promise.all([
    databaseConnection.getAll(STORES.todo),
    databaseConnection.getPlayerStore(STORES.task, currentPlayerUUID),
    databaseConnection.getAll(STORES.matchScoreEvent),
  ]);
  return {
    scores: buildInMemoryMatchScores({ match, currentPlayerUUID, taskHistory, scoreEvents }),
    // Planning definitions are workspace-wide. Completion history and score
    // evidence remain attributed to the active Match participant.
    todos: todos || [],
    taskHistory,
    scoreEvents: scoreEvents.filter((event) => String(event.matchUUID) === String(match.UUID)),
    teams: getMatchTeams(match),
  };
}
