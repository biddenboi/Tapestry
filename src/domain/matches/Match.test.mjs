import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const HOUR = 60 * 60 * 1000;

const source = (await readFile(new URL('./Match.js', import.meta.url), 'utf8'))
  .replace(
    "import { HOUR, STORES } from '@domain/constants.js';",
    "const HOUR = 60 * 60 * 1000; const STORES = { match: 'matches', task: 'tasks', matchScoreEvent: 'matchScoreEvents' };",
  )
  .replace(
    "import { getCanonicalTaskPoints, getTaskDuration } from '@domain/tasks/Tasks.js';",
    "const getTaskDuration = (task) => Math.max(0, new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()); const getCanonicalTaskPoints = (task) => Math.max(0, Math.floor(Number(task.pointsBase ?? task.points) || 0));",
  )
  .replace(
    "import { isEchoAllowed } from '@domain/rank/Rank.js';",
    "const isEchoAllowed = () => true;",
  )
  .replace(
    "import { getPlayerActivityState } from '@domain/matches/MatchActivity.js';",
    "const getPlayerActivityState = () => ({ label: 'Estimated' });",
  )
  .replace(
    `import {
  getMatchDurationHours,
  getMatchTeams,
  PAIR_MATCH_MAX_TEAM_RATING_GAP,
  PAIR_MATCH_RATING_RANGE,
} from '@domain/matches/MatchContracts.js';`,
    `const getMatchDurationHours = (match) => Number(match.duration || 0);
const getMatchTeams = (match) => match.teams || [];
const PAIR_MATCH_MAX_TEAM_RATING_GAP = 150;
const PAIR_MATCH_RATING_RANGE = 400;`,
  );

const { buildGhostRoster } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('ghost roster estimates opponents from history visible at the match IGT', async () => {
  const viewerIGT = 10 * HOUR;
  const currentPlayer = { UUID: 'me', username: 'Me', elo: 1000, createdAt: '2026-01-01T00:00:00.000Z' };
  const players = [
    currentPlayer,
    { UUID: 'p1', username: 'Past Profile', elo: 1000 },
    { UUID: 'p2', username: 'P2', elo: 1000 },
    { UUID: 'p3', username: 'P3', elo: 1000 },
  ];
  const matches = [
    {
      UUID: 'past-match',
      status: 'complete',
      parent: 'p1',
      createdAt: '2026-01-01T00:00:00.000Z',
      duration: 1,
      inGameTimestamp: 4 * HOUR,
      completedInGameTimestamp: 5 * HOUR,
      teams: [[{ UUID: 'p1' }], [{ UUID: 'other' }]],
      result: { playerScores: { p1: 100 } },
    },
    {
      UUID: 'future-match',
      status: 'complete',
      parent: 'p1',
      createdAt: '2026-01-02T00:00:00.000Z',
      duration: 1,
      inGameTimestamp: 20 * HOUR,
      completedInGameTimestamp: 21 * HOUR,
      teams: [[{ UUID: 'p1' }], [{ UUID: 'other' }]],
      result: { playerScores: { p1: 5000 } },
    },
  ];
  const tasksByPlayer = {
    p1: [
      {
        UUID: 'past-task',
        parent: 'p1',
        name: 'visible task',
        points: 100,
        createdAt: '2026-01-01T00:10:00.000Z',
        completedAt: '2026-01-01T00:20:00.000Z',
        inGameTimestamp: 5 * HOUR,
      },
      {
        UUID: 'future-task',
        parent: 'p1',
        name: 'future task',
        points: 5000,
        createdAt: '2026-01-02T00:10:00.000Z',
        completedAt: '2026-01-02T00:20:00.000Z',
        inGameTimestamp: 21 * HOUR,
      },
    ],
  };
  const calls = [];
  const db = {
    async getCompletedMatchesThroughIGT(limit) {
      calls.push(['matchesThroughIGT', limit]);
      return matches;
    },
    async getPlayerStoreThroughIGT(store, playerUUID, limit) {
      calls.push(['tasksThroughIGT', store, playerUUID, limit]);
      return (tasksByPlayer[playerUUID] || []).filter((task) => Number(task.inGameTimestamp || 0) <= limit);
    },
    async getAll() {
      throw new Error('latest match history should not be used for IGT-bound matchmaking');
    },
    async getPlayerStore(store) {
      if (store === 'matchScoreEvents') return [];
      throw new Error('latest task history should not be used for IGT-bound matchmaking');
    },
  };

  const roster = await buildGhostRoster(db, players, currentPlayer, 1, { viewerIGT });
  const generated = [...roster.teammates, ...roster.opponents];
  const p1 = generated.find((player) => player.UUID === 'p1');

  assert.equal(p1.replayTrace.sourceMatchUUID, 'past-match');
  assert.equal(p1.estimatedTotal, 100);
  assert.ok(calls.some(([name, limit]) => name === 'matchesThroughIGT' && limit === viewerIGT));
  assert.ok(calls.some(([name, , playerUUID, limit]) => (
    name === 'tasksThroughIGT' && playerUUID === 'p1' && limit === viewerIGT
  )));
});
