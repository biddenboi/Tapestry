import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 041 adds Road, stat, reveal, and achievement-stage receipts without changing existing records', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  const targetIndex = SQLITE_MIGRATIONS.findIndex(({ id }) => id === '041_unified_contribution_road');
  assert.ok(targetIndex > 0);
  client.applyMigrations(SQLITE_MIGRATIONS.slice(0, targetIndex), { applicationVersion: 'before-road' });
  const now = '2026-07-28T12:00:00.000Z';
  await client.query({
    sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)',
    bind: ['p1', 'Wayfinder', now, '{}'],
    result: 'changes',
  });
  const playerCount = await client.query({ sql: 'SELECT COUNT(*) FROM players', result: 'value' });

  client.applyMigrations([SQLITE_MIGRATIONS[targetIndex]], { applicationVersion: 'unified-road-test' });

  assert.equal(await client.query({ sql: 'SELECT COUNT(*) FROM players', result: 'value' }), playerCount);
  assert.equal(await client.query({ sql: 'SELECT catalog_id FROM contribution_road_catalog_versions WHERE catalog_version=1', result: 'value' }), 'unified-contribution-road-v1');
  for (const table of [
    'document_contribution_road_stats',
    'document_contribution_road_choices',
    'document_contribution_road_unlocks',
    'document_contribution_road_migrations',
    'document_interface_reveal_receipts',
    'achievement_stage_receipts',
    'contribution_road_stat_source_receipts',
    'contribution_road_commit_receipts',
  ]) {
    assert.equal(await client.query({
      sql: "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name=?",
      bind: [table],
      result: 'value',
    }), 1, `${table} should exist`);
  }
  assert.equal((await client.integrityCheck()).ok, true);
});
