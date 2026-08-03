import assert from 'node:assert/strict';
import test from 'node:test';
import MigrationRunner from './MigrationRunner.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import { SQLITE_ERROR_CODES } from './sqliteErrors.js';

test('migration manifest checksums match their immutable source', async () => {
  const calls = [];
  const runner = new MigrationRunner({
    client: { applyMigrations: (...args) => { calls.push(args); return { applied: [] }; } },
    migrations: SQLITE_MIGRATIONS,
    applicationVersion: 'test',
  });
  const result = await runner.run();
  assert.deepEqual(result, { applied: [] });
  assert.equal(calls[0][0].length, SQLITE_MIGRATIONS.length);
  assert.equal(calls[0][1].applicationVersion, 'test');
});

test('shipped migrations retain the manifests already registered by existing databases', () => {
  const shippedChecksums = {
    '003_core_profiles': 'caa3d8069653c0e36788973eca19782c01c1ef0b87f8111b8e06e78ef883c039',
    '004_planning': 'a41c07884fc03784c62e098c7cce6e02416705e3832a5118ea5d8dce2370a8d9',
    '013_social_notifications': '248f55a3122e071917f1394b4dd0d4014040463a8c31d59545d653841e398f58',
    '014_recovery_model_derived': '6a6073f1ecb28346383ee60f926ab0237753b6c9f2d6e713e2d15b9e029df7f6',
    '020_dynamic_social_cast': '18bb94cfe44bc21ef7a6e02797a70e9689dd3a0ce079a23d625319a007139a9c',
    '023_dojo_session_standings': 'e6c5c8725a8aafbee5bcb4e35c4dcf70b561bcbcc944bc79cfaed8cdbfa54d88',
  };
  for (const [id, checksum] of Object.entries(shippedChecksums)) {
    assert.equal(SQLITE_MIGRATIONS.find((migration) => migration.id === id)?.checksum, checksum, id);
  }

  const core = SQLITE_MIGRATIONS.find(({ id }) => id === '003_core_profiles');
  assert.doesNotMatch(core.sql, /\n  money_minor INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(core.sql, /utc_time_at_start TEXT/);
  assert.doesNotMatch(core.sql, /legacy_bootstrap INTEGER NOT NULL DEFAULT 0/);
  assert.equal(core.compatibleChecksums.includes(
    'f20a1bf81e65c1a0dc3ab90f5ba8e6c649423fb1ea94ca083c062c343d654f3d',
  ), true);
});

test('migration runner rejects source edits before contacting SQLite', async () => {
  let called = false;
  const runner = new MigrationRunner({
    client: { applyMigrations: () => { called = true; } },
    migrations: [{ ...SQLITE_MIGRATIONS[0], sql: `${SQLITE_MIGRATIONS[0].sql}\n-- edited` }],
  });
  await assert.rejects(runner.run(), (error) => (
    error.code === SQLITE_ERROR_CODES.migrationChecksumMismatch
  ));
  assert.equal(called, false);
});
