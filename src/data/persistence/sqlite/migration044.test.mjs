import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 044 restores legacy task base points in typed and document stores', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());

  const targetIndex = SQLITE_MIGRATIONS.findIndex(
    ({ id }) => id === '044_legacy_task_base_points',
  );
  assert.ok(targetIndex > 0);
  client.applyMigrations(SQLITE_MIGRATIONS.slice(0, targetIndex), {
    applicationVersion: 'before-legacy-points-repair',
  });

  const createdAt = '2026-07-28T10:00:00.000Z';
  const completedAt = '2026-07-28T11:00:00.000Z';
  await client.executeAtomic({
    commandId: 'seed-legacy-points',
    label: 'seed-legacy-points',
    statements: [
      {
        sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)',
        bind: ['p1', 'Worker', createdAt, '{}'],
      },
      {
        sql: `INSERT INTO tasks(id,player_id,name,points,points_base,created_at,completed_at,extra_json)
              VALUES(?,?,?,?,?,?,?,?)`,
        bind: ['task-1', 'p1', 'Legacy work', 42, 0, createdAt, completedAt, '{}'],
      },
      {
        sql: `INSERT INTO document_tasks(
                uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
              ) VALUES(?,?,?,?,?,?,?,?)`,
        bind: [
          'task-1',
          JSON.stringify({
            UUID: 'task-1',
            parent: 'p1',
            name: 'Legacy work',
            points: 42,
            createdAt,
            completedAt,
          }),
          'p1',
          createdAt,
          completedAt,
          0,
          completedAt,
          1,
        ],
      },
    ],
  });

  client.applyMigrations([SQLITE_MIGRATIONS[targetIndex]], {
    applicationVersion: 'legacy-points-repair-test',
  });

  assert.equal(await client.query({
    sql: 'SELECT points_base FROM tasks WHERE id=?',
    bind: ['task-1'],
    result: 'value',
  }), 42);
  assert.equal(await client.query({
    sql: "SELECT json_extract(record_json,'$.pointsBase') FROM document_tasks WHERE uuid=?",
    bind: ['task-1'],
    result: 'value',
  }), 42);
  assert.equal(await client.query({
    sql: 'SELECT task_points FROM profile_summary_view WHERE player_id=?',
    bind: ['p1'],
    result: 'value',
  }), 42);
  assert.equal((await client.integrityCheck({ mode: 'full', reason: 'migration-044-test' })).ok, true);
});
