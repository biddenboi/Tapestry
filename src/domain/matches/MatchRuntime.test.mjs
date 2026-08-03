import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('./MatchRuntime.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { todo: 'todos', task: 'tasks', matchScoreEvent: 'matchScoreEvents' };")
  .replace("import { buildGhostScoresSync } from '@domain/matches/Match.js';", "const buildGhostScoresSync = () => ({ ghost: 12 });")
  .replace("import { getMatchTeams } from '@domain/matches/MatchContracts.js';", "const getMatchTeams = (match) => match.teams || [];")
  .replace("import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';", "const getCanonicalTaskPoints = (task) => Math.max(0, Math.floor(Number(task.pointsBase ?? task.points) || 0));")
  .replace("import { reconstructMatchScores } from '@domain/matches/MatchScoring.js';", "const reconstructMatchScores = (events) => events.reduce((scores, event) => ({ ...scores, [event.participantUUID]: (scores[event.participantUUID] || 0) + event.points }), {});");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('active match input reads shared todos and only the current player task history', async () => {
  const reads = [];
  const db = {
    async getPlayerStore(store, parent) {
      reads.push(['player', store, parent]);
      if (store === 'todos') return [{ UUID: 'todo-1', parent }];
      return [{
        UUID: 'task-1',
        parent,
        completedAt: '2026-01-01T00:10:00.000Z',
        points: 20,
        pointsBase: 200,
      }];
    },
    async getAll(store) {
      reads.push(['all', store]);
      return [];
    },
  };
  const result = await runtime.loadMatchRuntimeInput(db, {
    createdAt: '2026-01-01T00:00:00.000Z',
    teams: [[{ UUID: 'p1' }], [{ UUID: 'ghost' }]],
  }, 'p1');
  assert.deepEqual(reads, [
    ['all', 'todos'],
    ['player', 'tasks', 'p1'],
    ['all', 'matchScoreEvents'],
  ]);
  assert.equal(result.scores.p1, 200);
  assert.equal(result.scores.ghost, 12);
});
