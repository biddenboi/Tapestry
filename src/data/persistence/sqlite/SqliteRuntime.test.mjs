import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteRuntime, { TAPESTRY_SQLITE_APPLICATION_ID } from './SqliteRuntime.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import { SQLITE_ERROR_CODES } from './sqliteErrors.js';

const createRuntime = () => new SqliteRuntime({ logger: { warn() {} }, random: () => 0 });

async function openRuntime() {
  const runtime = createRuntime();
  const initialization = await runtime.initialize({ mode: 'memory' });
  runtime.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'test' });
  return { runtime, initialization };
}

test('memory runtime applies the selected connection policy and migrations', async (t) => {
  const { runtime, initialization } = await openRuntime();
  t.after(() => runtime.close());
  assert.equal(initialization.sqliteVersion, '3.53.0');
  assert.equal(initialization.pragmas.foreignKeys, 1);
  assert.equal(initialization.pragmas.busyTimeoutMs, 750);
  assert.equal(initialization.pragmas.applicationId, TAPESTRY_SQLITE_APPLICATION_ID);
  const status = runtime.status();
  assert.deepEqual(
    status.migrations.map(({ id, outcome }) => ({ id, outcome })),
    SQLITE_MIGRATIONS.map(({ id }) => ({ id, outcome: 'applied' })),
  );
  assert.equal(status.metadata['runtime.clean_shutdown'], false);
});

test('migration replay is skipped and changed checksums fail closed', async (t) => {
  const { runtime } = await openRuntime();
  t.after(() => runtime.close());
  const replay = runtime.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'test' });
  assert.deepEqual(replay.applied, []);
  assert.deepEqual(replay.skipped, SQLITE_MIGRATIONS.map(({ id }) => id));
  assert.throws(() => runtime.applyMigrations([
    { ...SQLITE_MIGRATIONS[0], checksum: '0'.repeat(64) },
  ]), (error) => error.code === SQLITE_ERROR_CODES.migrationChecksumMismatch);
});

test('a migration can explicitly grandfather a previously registered equivalent checksum', async (t) => {
  const { runtime } = await openRuntime();
  t.after(() => runtime.close());
  const migration = SQLITE_MIGRATIONS.find(({ id }) => id === '042_preset_appearance_system');
  const compatible = migration.compatibleChecksums[0];
  runtime.query({
    sql: 'UPDATE schema_migrations SET checksum=? WHERE migration_id=?',
    bind: [compatible, migration.id],
  });
  const replay = runtime.applyMigrations([migration], { applicationVersion: 'compatibility-test' });
  assert.deepEqual(replay.applied, []);
  assert.deepEqual(replay.skipped, [migration.id]);
});

test('a forward migration can repair a known registered schema variant atomically', async (t) => {
  const runtime = createRuntime();
  await runtime.initialize({ mode: 'memory' });
  t.after(() => runtime.close());
  runtime.applyMigrations([{
    id: '001_variant',
    sql: 'CREATE TABLE variant_probe(id TEXT PRIMARY KEY) STRICT;',
    checksum: 'registered-variant',
  }]);
  runtime.applyMigrations([{
    id: '002_repair',
    sql: "INSERT INTO variant_probe(id, repaired) VALUES('row', 1);",
    checksum: 'repair-checksum',
    compatibilityRepairs: [{
      migrationId: '001_variant',
      checksums: ['registered-variant'],
      sql: 'ALTER TABLE variant_probe ADD COLUMN repaired INTEGER NOT NULL DEFAULT 0;',
    }],
  }]);
  assert.equal(runtime.query({
    sql: "SELECT repaired FROM variant_probe WHERE id='row'",
    result: 'value',
  }), 1);
});

test('atomic batches roll back every statement when one statement fails', async (t) => {
  const { runtime } = await openRuntime();
  t.after(() => runtime.close());
  runtime.query({ sql: 'CREATE TABLE rollback_probe(id TEXT PRIMARY KEY) STRICT' });
  await assert.rejects(runtime.executeAtomic({
    commandId: 'rollback-command',
    statements: [
      { sql: 'INSERT INTO rollback_probe(id) VALUES(?)', bind: ['first'], result: 'changes' },
      { sql: 'INSERT INTO table_that_does_not_exist(id) VALUES(?)', bind: ['second'] },
    ],
  }));
  assert.equal(runtime.query({ sql: 'SELECT count(*) FROM rollback_probe', result: 'value' }), 0);
  assert.equal(runtime.query({
    sql: 'SELECT count(*) FROM runtime_command_receipts WHERE command_id=?',
    bind: ['rollback-command'],
    result: 'value',
  }), 0);
});

test('duplicate atomic command IDs return the committed receipt exactly once', async (t) => {
  const { runtime } = await openRuntime();
  t.after(() => runtime.close());
  runtime.query({ sql: 'CREATE TABLE duplicate_probe(id TEXT PRIMARY KEY) STRICT' });
  const command = {
    commandId: 'duplicate-command',
    label: 'duplicate-proof',
    statements: [{
      sql: 'INSERT INTO duplicate_probe(id) VALUES(?)',
      bind: ['only-row'],
      result: 'changes',
    }],
  };
  const first = await runtime.executeAtomic(command);
  const second = await runtime.executeAtomic(command);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.statementResults, first.statementResults);
  assert.equal(runtime.query({ sql: 'SELECT count(*) FROM duplicate_probe', result: 'value' }), 1);
});

test('simulated worker termination before commit leaves no partial rows or receipt', async (t) => {
  const { runtime } = await openRuntime();
  t.after(() => runtime.close());
  runtime.query({ sql: 'CREATE TABLE termination_probe(id TEXT PRIMARY KEY) STRICT' });
  await assert.rejects(runtime.executeAtomic({
    commandId: 'termination-command',
    statements: [{ sql: 'INSERT INTO termination_probe(id) VALUES(?)', bind: ['uncommitted'] }],
  }, {
    beforeCommit() { throw new Error('simulated worker termination'); },
  }), /simulated worker termination/);
  assert.equal(runtime.query({ sql: 'SELECT count(*) FROM termination_probe', result: 'value' }), 0);
  assert.equal(runtime.query({
    sql: 'SELECT count(*) FROM runtime_command_receipts WHERE command_id=?',
    bind: ['termination-command'],
    result: 'value',
  }), 0);
});

test('integrity hooks run quick and full checks with foreign keys', async (t) => {
  const { runtime } = await openRuntime();
  t.after(() => runtime.close());
  assert.equal(runtime.integrityCheck({ mode: 'quick' }).ok, true);
  assert.equal(runtime.integrityCheck({ mode: 'full' }).ok, true);
});
