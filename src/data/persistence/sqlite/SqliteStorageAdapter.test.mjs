import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteStorageAdapter from './SqliteStorageAdapter.js';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import { SQLITE_ERROR_CODES } from './sqliteErrors.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import { validateAtomicCommand } from './sqliteProtocol.js';

test('SqliteStorageAdapter opens the real WASM engine in memory for Node parity tests', async (t) => {
  const client = new InProcessSqliteClient();
  const adapter = new SqliteStorageAdapter({ client });
  t.after(() => adapter.close());
  const opened = await adapter.open({ mode: 'memory' });
  assert.equal(opened.initialization.initialized, true);
  assert.deepEqual(opened.migrations.applied, SQLITE_MIGRATIONS.map(({ id }) => id));
  const record = { UUID: 'adapter-task', parent: 'player-a', name: 'Adapter proof', inGameTimestamp: 0 };
  assert.equal(await adapter.put('tasks', record, { operationId: 'adapter-put' }), record.UUID);
  assert.deepEqual(await adapter.get('tasks', record.UUID), record);
});

test('SQLite adapter rejects client-held async transaction callbacks', async (t) => {
  const client = new InProcessSqliteClient();
  const adapter = new SqliteStorageAdapter({ client });
  t.after(() => adapter.close());
  await adapter.open({ mode: 'memory' });
  assert.throws(() => adapter.transaction(async () => undefined), (error) => (
    error.code === SQLITE_ERROR_CODES.invalidAtomicBatch
  ));
});

test('idempotent atomic commands receive a bounded busy retry policy by default', () => {
  const command = validateAtomicCommand({
    commandId: 'busy-default',
    statements: [{ sql: 'SELECT 1', result: 'value' }],
  });
  assert.equal(command.maxBusyRetries, 2);
  assert.equal(validateAtomicCommand({
    commandId: 'busy-disabled',
    maxBusyRetries: 0,
    statements: [{ sql: 'SELECT 1', result: 'value' }],
  }).maxBusyRetries, 0);
});

test('verified compact snapshots replace the active database without mixing records', async (t) => {
  const client = new InProcessSqliteClient();
  const adapter = new SqliteStorageAdapter({ client });
  t.after(() => adapter.close());
  await adapter.open({ mode: 'memory' });
  await adapter.put('tasks', { UUID: 'before', name: 'Before export' }, { operationId: 'before-export' });
  const snapshot = await adapter.exportSnapshot();
  await adapter.put('tasks', { UUID: 'after', name: 'After export' }, { operationId: 'after-export' });

  await adapter.restoreSnapshot({ byteArray: snapshot.byteArray });
  assert.equal((await adapter.get('tasks', 'before')).name, 'Before export');
  assert.equal(await adapter.get('tasks', 'after'), null);
  const verification = await adapter.verifySnapshot(await adapter.exportSnapshot());
  assert.equal(verification.quickCheck, 'ok');
  assert.deepEqual(verification.foreignKeyViolations, []);
});

test('restored older snapshots apply pending migrations before document hydration', async (t) => {
  const throughSchema40 = SQLITE_MIGRATIONS.slice(
    0,
    SQLITE_MIGRATIONS.findIndex(({ id }) => id === '041_unified_contribution_road'),
  );
  const oldClient = new InProcessSqliteClient();
  const oldAdapter = new SqliteStorageAdapter({
    client: oldClient,
    migrations: throughSchema40,
  });
  const currentClient = new InProcessSqliteClient();
  const currentAdapter = new SqliteStorageAdapter({ client: currentClient });
  t.after(() => Promise.all([oldAdapter.close(), currentAdapter.close()]));
  await oldAdapter.open({ mode: 'memory' });
  await oldAdapter.put('players', {
    UUID: 'restore-profile',
    username: 'Restored',
    inGameTime: 0,
  }, { operationId: 'older-snapshot-player' });
  const snapshot = await oldAdapter.exportSnapshot();

  await currentAdapter.open({ mode: 'memory' });
  await currentAdapter.restoreSnapshot({ byteArray: snapshot.byteArray });
  await currentAdapter.applyPendingMigrations();

  assert.equal(await currentClient.query({
    sql: "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='document_contribution_road_stats'",
    result: 'value',
  }), 1);
  assert.equal((await currentAdapter.get('players', 'restore-profile')).username, 'Restored');
});
