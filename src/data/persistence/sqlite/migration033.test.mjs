import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 033 installs the Pair Match lock and immutable snapshot columns', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'pair-match-test' });

  const columns = await client.query({
    sql: 'PRAGMA table_info(matches)',
    result: 'all',
  });
  const names = new Set(columns.map((column) => column.name));
  for (const name of [
    'ruleset_id',
    'locked_at',
    'rules_snapshot_json',
    'context_snapshot_json',
    'legacy_rules_json',
  ]) {
    assert.equal(names.has(name), true, `missing ${name}`);
  }
  const integrity = await client.integrityCheck();
  assert.equal(integrity.ok, true);
});
