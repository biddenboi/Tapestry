import assert from 'node:assert/strict';
import test from 'node:test';

import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 047 stores immutable scoring intervals with indexed windows', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'effect-interval-test' });
  const tables = await client.query({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='effect_intervals'",
      result: 'all',
    });
    assert.equal(tables.length, 1);
    const indexes = await client.query({
      sql: "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='effect_intervals'",
      result: 'all',
    });
    assert.equal(indexes.some(({ name }) => name === 'effect_intervals_player_window_idx'), true);
});
