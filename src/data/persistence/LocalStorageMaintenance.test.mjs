import test from 'node:test';
import assert from 'node:assert/strict';
import InProcessSqliteClient from './sqlite/testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './sqlite/migrations/index.js';
import SqliteDocumentRepository from './sqlite/SqliteDocumentRepository.js';
import { compactLocalDatabase } from './LocalStorageMaintenance.js';

test('offline compaction shrinks unused pages and preserves records and pending sync payloads', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'compaction-test' });
  t.after(() => client.close());
  const documents = new SqliteDocumentRepository(client);
  await documents.put('todos', { UUID: 'keep', name: 'Unsynced work', syncUpdatedAt: '2026-09-14T00:00:00Z' });
  const recordsBefore = await documents.getAll('todos');
  const outboxBefore = await client.query({ sql: 'SELECT * FROM sync_reference_outbox', result: 'all' });
  await client.query({ sql: 'CREATE TABLE disposable_test_space(bytes BLOB)', result: 'none' });
  await client.query({ sql: 'INSERT INTO disposable_test_space VALUES(zeroblob(4000000))', result: 'changes' });
  await client.query({ sql: 'DELETE FROM disposable_test_space', result: 'changes' });
  const connection = { ready: Promise.resolve(), async flushWrites() {}, syncRuntime: { client, transport: null } };
  const first = compactLocalDatabase(connection);
  assert.equal(compactLocalDatabase(connection), first);
  const result = await first;
  assert.ok(result.reclaimedBytes > 3000000);
  assert.deepEqual(await documents.getAll('todos'), recordsBefore);
  assert.deepEqual(await client.query({ sql: 'SELECT * FROM sync_reference_outbox', result: 'all' }), outboxBefore);
  assert.equal(await client.query({ sql: 'PRAGMA quick_check', result: 'value' }), 'ok');
});
