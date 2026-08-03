import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 032 installs normalized profile context and canonical document contracts', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'profile-context-test' });
  const required = [
    'profile_context_items',
    'profile_context_recipients',
    'profile_context_suggestions',
    'profile_context_preferences',
    'profile_context_audit',
    'document_profile_context_items',
    'document_profile_context_recipients',
    'document_profile_context_suggestions',
    'document_profile_context_preferences',
    'document_profile_context_audit',
  ];
  const rows = await client.query({
    sql: `SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${required.map(() => '?').join(',')})`,
    bind: required,
    result: 'all',
  });
  assert.deepEqual(new Set(rows.map((row) => row.name)), new Set(required));
  const integrity = await client.integrityCheck();
  assert.equal(integrity.ok, true);
});

