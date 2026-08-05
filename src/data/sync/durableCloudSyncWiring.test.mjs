import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calculateMigrationChecksum } from '../persistence/sqlite/migrationChecksum.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('every mobile-safe canonical document table has durable put and delete capture', async () => {
  const { DURABLE_REFERENCE_CAPTURE_SQL: sql, migration052 } = await import(
    '../persistence/sqlite/migrations/052_durable_reference_capture.js'
  );
  const checksum = migration052.checksum;
  assert.equal((sql.match(/CREATE TRIGGER /g) || []).length, 117);
  assert.equal((sql.match(/AFTER INSERT ON /g) || []).length, 39);
  assert.equal((sql.match(/AFTER UPDATE ON /g) || []).length, 39);
  assert.equal((sql.match(/AFTER DELETE ON /g) || []).length, 39);
  assert.equal(await calculateMigrationChecksum(migration052), checksum);
  assert.match(sql, /document_todos/);
  assert.match(sql, /document_players/);
  assert.match(sql, /document_chronicle_entry_revisions/);
});

test('remote reference application is guarded inside the same SQLite transaction', async () => {
  const [{ REMOTE_REFERENCE_CAPTURE_GUARD_SQL: sql, migration053 }, host, documents] = await Promise.all([
    import('../persistence/sqlite/migrations/053_remote_reference_capture_guard.js'),
    read('../persistence/DatabaseConnectionHost.js'),
    read('../persistence/sqlite/SqliteDocumentRepository.js'),
  ]);
  assert.equal(await calculateMigrationChecksum(migration053), migration053.checksum);
  assert.match(sql, /sync_reference_capture_state/);
  assert.match(sql, /WHEN COALESCE\(\(SELECT enabled/);
  assert.match(host, /beforeStatements: captureGuard\.beforeStatements/);
  assert.match(host, /afterStatements: captureGuard\.afterStatements/);
  assert.match(documents, /beforeStatements = \[\]/);
  assert.match(documents, /afterStatements = \[\]/);
});

test('SQLite writes mark the full cloud checkpoint dirty below feature code', async () => {
  const [adapter, runtime, persistence] = await Promise.all([
    read('../persistence/sqlite/SqliteStorageAdapter.js'),
    read('./SyncRuntime.js'),
    read('../persistence/PersistenceRuntime.js'),
  ]);
  assert.match(adapter, /setCommitListener/);
  assert.match(adapter, /changedRows/);
  assert.match(runtime, /databaseCommitted\(details = \{\}\)/);
  assert.match(runtime, /checkpointDirty = true/);
  assert.match(runtime, /COMMIT_SYNC_DELAY_MS/);
  assert.match(persistence, /setCommitListener/);
});

test('clean desktop startup restores cloud SQLite before enabling publication', async () => {
  const [gate, bootstrap, transport] = await Promise.all([
    read('../../app/data-source/DataSourceGate/DataSourceGate.jsx'),
    read('./supabase/SupabaseSyncBootstrap.js'),
    read('./supabase/SupabaseSyncTransport.js'),
  ]);
  assert.match(gate, /downloadDatabaseCheckpoint/);
  assert.match(gate, /downloadCheckpointWithoutBlocking/);
  assert.match(gate, /checkpoint-download-pending/);
  assert.match(gate, /restoreMobileBootstrapData/);
  assert.match(gate, /restoreCloudCheckpoint/);
  assert.match(gate, /setCheckpointPublishingEnabled\(true\)/);
  assert.match(bootstrap, /clean-device-restore-pending/);
  assert.match(bootstrap, /mobile-checkpoint-disabled/);
  assert.match(transport, /database-checkpoints\/latest\.json/);
});

test('downloads cross a cloud durability barrier before ZIP construction', async () => {
  const source = await read('../persistence/services/ImportExportService.js');
  assert.match(source, /pre-export-durability-barrier/);
  assert.match(source, /publishCloudCheckpoint\?\.\(\{ force: true/);
  assert.match(source, /did not create a potentially stale download/);
  assert.match(source, /zip\.file\('tapestry\.sqlite'/);
});
