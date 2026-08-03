import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 034 installs Next Move storage and upgrades canonical planning metadata', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());

  const targetIndex = SQLITE_MIGRATIONS.findIndex(
    ({ id }) => id === '034_next_move_phase_navigator',
  );
  const earlier = SQLITE_MIGRATIONS.slice(0, targetIndex);
  client.applyMigrations(earlier, { applicationVersion: 'before-next-move' });
  await client.executeAtomic({
    commandId: 'seed-before-next-move',
    label: 'seed-before-next-move',
    statements: [
      {
        sql: `INSERT INTO players(id,username,created_at,extra_json)
              VALUES(?,?,?,?)`,
        bind: ['player-1', 'Tester', '2026-07-28T00:00:00.000Z', '{}'],
      },
      {
        sql: `INSERT INTO todos(
                id,player_id,name,description,plan_notes,created_at,in_game_timestamp,extra_json
              ) VALUES(?,?,?,?,?,?,?,?)`,
        bind: [
          'task-1',
          'player-1',
          'Legacy task',
          null,
          'First write an outline #plan',
          '2026-07-28T00:00:00.000Z',
          0,
          '{}',
        ],
      },
      {
        sql: `INSERT INTO document_todos(
                uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
              ) VALUES(?,?,?,?,?,?,?,?)`,
        bind: [
          'task-1',
          JSON.stringify({
            UUID: 'task-1',
            parent: 'player-1',
            name: 'Legacy task',
            efficiency: 'First write an outline #plan',
          }),
          'player-1',
          '2026-07-28T00:00:00.000Z',
          '2026-07-28T00:00:00.000Z',
          0,
          'legacy',
          1,
        ],
      },
    ],
  });

  const migration = SQLITE_MIGRATIONS.find(({ id }) => id === '034_next_move_phase_navigator');
  client.applyMigrations([migration], { applicationVersion: 'next-move-test' });

  const requiredTables = [
    'task_plan_receipts',
    'next_move_decisions',
    'next_move_feedback',
    'next_move_surface_preferences',
    'document_task_plan_receipts',
    'document_next_move_decisions',
    'document_next_move_feedback',
    'document_next_move_surface_preferences',
  ];
  const rows = await client.query({
    sql: `SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${requiredTables.map(() => '?').join(',')})`,
    bind: requiredTables,
    result: 'all',
  });
  assert.deepEqual(new Set(rows.map(({ name }) => name)), new Set(requiredTables));

  const columns = await client.query({ sql: 'PRAGMA table_info(todos)', result: 'all' });
  const names = new Set(columns.map(({ name }) => name));
  for (const name of ['plan_eligible', 'task_revision_hash', 'blocker_type', 'clarification_failures']) {
    assert.equal(names.has(name), true, `missing ${name}`);
  }

  const typed = await client.query({
    sql: 'SELECT description,plan_eligible FROM todos WHERE id=?',
    bind: ['task-1'],
    result: 'one',
  });
  assert.deepEqual(typed, {
    description: 'First write an outline #plan',
    plan_eligible: 1,
  });
  const document = await client.query({
    sql: `SELECT json_extract(record_json,'$.description') AS description,
                 json_extract(record_json,'$.planEligible') AS plan_eligible
          FROM document_todos WHERE uuid=?`,
    bind: ['task-1'],
    result: 'one',
  });
  assert.deepEqual(document, {
    description: 'First write an outline #plan',
    plan_eligible: 1,
  });
  assert.equal((await client.integrityCheck()).ok, true);
});
