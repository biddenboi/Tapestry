import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 031 installs continuity relational and document contracts', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'continuity-test' });

  const required = [
    'action_plans',
    'action_sessions',
    'handoffs',
    'rhythm_definitions',
    'rhythm_opportunities',
    'intervention_decisions',
    'reward_provenance',
    'world_consequence_receipts',
    'match_score_events',
    'document_action_sessions',
    'document_handoffs',
  ];
  const rows = await client.query({
    sql: `SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${required.map(() => '?').join(',')})`,
    bind: required,
    result: 'all',
  });
  assert.deepEqual(new Set(rows.map((row) => row.name)), new Set(required));

  const presenceColumns = await client.query({
    sql: 'PRAGMA table_info(semantic_presence_intervals)',
    result: 'all',
  });
  const names = new Set(presenceColumns.map((column) => column.name));
  assert.ok(names.has('visibility_policy'));
  assert.ok(names.has('expires_at'));

  const integrity = await client.integrityCheck();
  assert.equal(integrity.ok, true);
});
