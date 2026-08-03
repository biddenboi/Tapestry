import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./ProfileBiography.js', import.meta.url), 'utf8'))
  .replace(
    "import { computeRarity, getAchievementByKey, getRarityLabel } from '@domain/achievements/Achievements.js';",
    "const computeRarity = () => 'common'; const getAchievementByKey = () => null; const getRarityLabel = (value) => value;",
  )
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { player: 'players', task: 'tasks', journal: 'journals', event: 'events', transaction: 'transactions', match: 'matches', contribution: 'contributions' };",
  )
  .replace(
    "import { getProfileMatchOutcome } from '@domain/profile/Profile.js';",
    "const getProfileMatchOutcome = (match) => match.result || 'loss';",
  )
  .replace(
    "import { getRankLabel } from '@domain/rank/Rank.js';",
    "const getRankLabel = (elo) => String(elo);",
  );

const biography = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('profile replay snapshots update history as viewer IGT crosses completed records', async () => {
  const tasks = [
    { UUID: 'early', parent: 'p1', name: 'Early task', completedAt: '2026-06-01T10:00:00Z', inGameTimestamp: 50, completedInGameTimestamp: 100, points: 20 },
    { UUID: 'future', parent: 'p1', name: 'Future task', completedAt: '2026-06-01T11:00:00Z', inGameTimestamp: 60, completedInGameTimestamp: 300, points: 2200 },
  ];
  const matches = [
    { UUID: 'match-early', parent: 'p1', status: 'complete', participantUUIDs: ['p1'], completedInGameTimestamp: 150, result: 'win' },
    { UUID: 'match-future', parent: 'p1', status: 'complete', participantUUIDs: ['p1'], completedInGameTimestamp: 350, result: 'win' },
  ];
  const byStore = {
    tasks,
    journals: [],
    events: [],
    transactions: [],
    contributions: [],
  };
  const databaseConnection = {
    async getPlayerAtIGT() {
      return { UUID: 'p1', username: 'Mika', elo: 900 };
    },
    async getPlayerStoreThroughIGT(store, _profileUUID, viewerIGT) {
      return (byStore[store] || []).filter((record) => (
        Number(record.completedInGameTimestamp ?? record.inGameTimestamp ?? 0) <= Number(viewerIGT)
      ));
    },
    async getVisibleMatchesForPlayer(_profileUUID, viewerIGT) {
      return matches.filter((record) => Number(record.completedInGameTimestamp ?? 0) <= Number(viewerIGT));
    },
  };

  const mid = await biography.buildProfileSnapshotAtIGT(databaseConnection, 'p1', 200);
  const late = await biography.buildProfileSnapshotAtIGT(databaseConnection, 'p1', 400);

  assert.deepEqual(mid.tasks.map((task) => task.UUID), ['early']);
  assert.deepEqual(mid.matches.map((match) => match.UUID), ['match-early']);
  assert.deepEqual(late.tasks.map((task) => task.UUID), ['early', 'future']);
  assert.deepEqual(late.matches.map((match) => match.UUID), ['match-early', 'match-future']);
});
