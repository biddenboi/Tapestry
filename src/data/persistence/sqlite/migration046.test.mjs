import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 046 creates the durable cross-device sync foundation', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());

  client.applyMigrations(SQLITE_MIGRATIONS, {
    applicationVersion: 'mobile-sync-foundation-test',
  });

  const tables = new Set((await client.query({
    sql: "SELECT name FROM sqlite_schema WHERE type='table'",
    result: 'all',
  })).map(({ name }) => name));
  for (const table of ['sync_devices', 'sync_operations', 'sync_cursors', 'sync_conflicts']) {
    assert.equal(tables.has(table), true, table);
  }

  const indexes = new Set((await client.query({
    sql: "SELECT name FROM sqlite_schema WHERE type='index'",
    result: 'all',
  })).map(({ name }) => name));
  assert.equal(indexes.has('sync_operations_pending_idx'), true);
  assert.equal(indexes.has('sync_conflicts_open_idx'), true);

  await client.query({
    sql: `INSERT INTO sync_devices(id,owner_id,display_name,platform,created_at,last_seen_at)
          VALUES('device-1','owner-1','Test device','test','2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z')`,
  });
  await client.query({
    sql: `INSERT INTO sync_operations(
            operation_id,owner_id,player_id,device_id,device_sequence,command_type,
            entity_type,entity_id,base_version,payload_json,occurred_at,status,created_at,updated_at
          ) VALUES(
            'operation-1','owner-1','player-1','device-1',1,'updateTask',
            'task','task-1',1,'{}','2026-08-02T00:00:00.000Z','pending',
            '2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
          )`,
  });
  assert.throws(() => client.query({
    sql: `INSERT INTO sync_operations(
            operation_id,owner_id,device_id,device_sequence,command_type,entity_type,
            entity_id,payload_json,occurred_at,status,created_at,updated_at
          ) VALUES(
            'operation-2','owner-1','device-1',1,'updateTask','task','task-2','{}',
            '2026-08-02T00:00:00.000Z','pending','2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
          )`,
  }));
  assert.equal((await client.integrityCheck({ mode: 'full', reason: 'migration-046-test' })).ok, true);
});
