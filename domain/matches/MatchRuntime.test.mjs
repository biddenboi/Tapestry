import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('./MatchRuntime.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { todo: 'todos', task: 'tasks' };")
  .replace("import { buildGhostScoresSync } from '@domain/matches/Match.js';", "const buildGhostScoresSync = () => ({ ghost: 12 });")
  .replace("import { getMatchTeams } from '@domain/matches/MatchContracts.js';", "const getMatchTeams = (match) => match.teams || [];");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('active match input reads only todos and the current player task history', async () => {
  const reads = [];
  const db = {
    async getPlayerStore(store, parent) {
      reads.push(['player', store, parent]);
      if (store === 'todos') return [{ UUID: 'todo-1', parent }];
      return [{ UUID: 'task-1', parent, completedAt: '2026-01-01T00:10:00.000Z', points: 20 }];
    },
  };
  const result = await runtime.loadMatchRuntimeInput(db, {
    createdAt: '2026-01-01T00:00:00.000Z',
    teams: [[{ UUID: 'p1' }], [{ UUID: 'ghost' }]],
  }, 'p1');
  assert.deepEqual(reads, [['player', 'todos', 'p1'], ['player', 'tasks', 'p1']]);
  assert.equal(result.scores.p1, 20);
  assert.equal(result.scores.ghost, 12);
});
