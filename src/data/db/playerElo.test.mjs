import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./databaseConnectionUtils.js', import.meta.url), 'utf8'))
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { task: 'tasks', journal: 'journals', event: 'events', transaction: 'transactions', match: 'matches', friendship: 'friendships', notification: 'notifications', journalComment: 'journalComments', eventLog: 'eventLogs', contribution: 'contributions' };",
  );

const utils = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('player Elo normalization preserves current Elo separately from historical base Elo', () => {
  assert.deepEqual(
    utils.normalizePlayerEloFields(
      { UUID: 'p1', username: 'Renamed' },
      { UUID: 'p1', username: 'Player', elo: 975, igtBaseElo: 940 },
    ),
    { UUID: 'p1', username: 'Renamed', elo: 975, igtBaseElo: 940 },
  );

  assert.deepEqual(
    utils.normalizePlayerEloFields({ UUID: 'p2', elo: 1010, igtBaseElo: 960 }),
    { UUID: 'p2', elo: 1010, igtBaseElo: 960 },
  );
});

test('player Elo normalization initializes missing base Elo without erasing progress', () => {
  assert.deepEqual(
    utils.normalizePlayerEloFields({ UUID: 'p3', elo: 880 }),
    { UUID: 'p3', elo: 880, igtBaseElo: 880 },
  );

  assert.deepEqual(
    utils.normalizePlayerEloFields({ UUID: 'p4', elo: -12, igtBaseElo: -40 }),
    { UUID: 'p4', elo: 0, igtBaseElo: 0 },
  );
});
