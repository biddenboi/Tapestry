import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 028 upgrades immutable legacy schemas without losing planning data', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());

  const targetIndex = SQLITE_MIGRATIONS.findIndex(
    ({ id }) => id === '028_immutable_migration_repair',
  );
  const earlier = SQLITE_MIGRATIONS.slice(0, targetIndex);
  client.applyMigrations(earlier, { applicationVersion: 'before-immutable-repair' });

  await client.executeAtomic({
    commandId: 'seed-before-immutable-repair',
    label: 'seed-before-immutable-repair',
    statements: [
      {
        sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)',
        bind: ['player-1', 'Tester', '2026-07-29T00:00:00.000Z', '{}'],
      },
      {
        sql: 'INSERT INTO projects(id,player_id,name,status,created_at,extra_json) VALUES(?,?,?,?,?,?)',
        bind: ['project-1', 'player-1', 'Project', 'active', '2026-07-29T00:00:00.000Z', '{}'],
      },
      {
        sql: 'INSERT INTO todos(id,player_id,project_id,name,created_at,extra_json) VALUES(?,?,?,?,?,?)',
        bind: ['todo-1', 'player-1', 'project-1', 'Todo', '2026-07-29T00:00:00.000Z', '{}'],
      },
      {
        sql: `INSERT INTO tasks(id,player_id,todo_id,name,points,points_base,created_at,completed_at,extra_json)
              VALUES(?,?,?,?,?,?,?,?,?)`,
        bind: ['task-1', 'player-1', 'todo-1', 'Task', 19, 19, '2026-07-29T00:00:00.000Z', '2026-07-29T01:00:00.000Z', '{}'],
      },
      {
        sql: 'INSERT INTO reminders(id,player_id,title,created_at,extra_json) VALUES(?,?,?,?,?)',
        bind: ['reminder-1', 'player-1', 'Reminder', '2026-07-29T00:00:00.000Z', '{}'],
      },
    ],
  });

  const migration = SQLITE_MIGRATIONS[targetIndex];
  client.applyMigrations([migration], { applicationVersion: 'immutable-repair-test' });

  for (const [table, expected] of Object.entries({
    projects: ['in_game_timestamp'],
    todos: ['in_game_timestamp'],
    tasks: ['points_base'],
    reminders: ['in_game_timestamp'],
  })) {
    const columns = await client.query({ sql: `PRAGMA table_info(${table})`, result: 'all' });
    const names = new Set(columns.map(({ name }) => name));
    for (const name of expected) assert.equal(names.has(name), true, `${table}.${name}`);
  }

  assert.equal(await client.query({
    sql: 'SELECT points_base FROM tasks WHERE id=?',
    bind: ['task-1'],
    result: 'value',
  }), 19);
  assert.equal(await client.query({
    sql: 'SELECT task_points FROM profile_summary_view WHERE player_id=?',
    bind: ['player-1'],
    result: 'value',
  }), 19);
  assert.equal(await client.query({
    sql: "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='dojo_rollup_backfill_state'",
    result: 'value',
  }), 0);
  assert.equal((await client.integrityCheck({ mode: 'full', reason: 'migration-028-test' })).ok, true);
});
