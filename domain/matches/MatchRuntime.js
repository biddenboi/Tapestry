import { STORES } from '@domain/constants.js';
import { buildGhostScoresSync } from '@domain/matches/Match.js';
import { getMatchTeams } from '@domain/matches/MatchContracts.js';

function withinMatch(task, match, nowIso) {
  const completedAt = String(task?.completedAt || '');
  return completedAt
    && completedAt >= String(match?.createdAt || '')
    && completedAt <= nowIso;
}

export function buildInMemoryMatchScores({
  match,
  currentPlayerUUID,
  taskHistory = [],
  now = Date.now(),
} = {}) {
  if (!match || !currentPlayerUUID) return {};
  const scores = buildGhostScoresSync(match, currentPlayerUUID, now);
  const nowIso = new Date(now).toISOString();
  scores[currentPlayerUUID] = (taskHistory || [])
    .filter((task) => String(task?.parent) === String(currentPlayerUUID))
    .filter((task) => withinMatch(task, match, nowIso))
    .reduce((sum, task) => sum + Number(task.points || 0), 0);
  return scores;
}

export async function loadMatchRuntimeInput(databaseConnection, match, currentPlayerUUID) {
  if (!databaseConnection || !match || !currentPlayerUUID) {
    return { scores: {}, todos: [], taskHistory: [], teams: [] };
  }
  const [todos, taskHistory] = await Promise.all([
    databaseConnection.getPlayerStore(STORES.todo, currentPlayerUUID),
    databaseConnection.getPlayerStore(STORES.task, currentPlayerUUID),
  ]);
  const ownedTodos = (todos || []).filter((todo) => (
    !todo.parent || String(todo.parent) === String(currentPlayerUUID)
  ));
  return {
    scores: buildInMemoryMatchScores({ match, currentPlayerUUID, taskHistory }),
    todos: ownedTodos,
    taskHistory,
    teams: getMatchTeams(match),
  };
}
