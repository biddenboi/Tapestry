import assert from 'node:assert/strict';
import test from 'node:test';

import MigrationRunner from './MigrationRunner.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import SqliteRuntime from './SqliteRuntime.js';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';

const phaseOne = SQLITE_MIGRATIONS.find(({ id }) => id === '050_workspace_planning_scope');
const beforePhaseOne = SQLITE_MIGRATIONS.filter(({ id }) => id < phaseOne.id);
const timestamp = '2026-08-02T12:00:00.000Z';

function documentStatement(table, UUID, parent) {
  return {
    sql: `INSERT INTO ${table}(uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence)
          VALUES(?,?,?,?,?,?,?,?)`,
    bind: [
      UUID,
      JSON.stringify({ UUID, parent, name: UUID }),
      parent,
      timestamp,
      timestamp,
      1,
      `${timestamp}:${UUID}`,
      1,
    ],
    result: 'changes',
  };
}

async function legacyContext() {
  const runtime = new SqliteRuntime({ logger: { warn() {} } });
  const client = new InProcessSqliteClient({ runtime });
  await client.initialize({ mode: 'memory' });
  await new MigrationRunner({
    client,
    migrations: beforePhaseOne,
    applicationVersion: 'migration-050-test-legacy',
  }).run();
  return { client, close: () => client.close() };
}

test('migration 050 preserves and workspace-scopes representative legacy planning data', async () => {
  const context = await legacyContext();
  try {
    await context.client.executeAtomic({
      commandId: 'seed-migration-050',
      statements: [
        {
          sql: `INSERT INTO players(id,username,created_at,updated_at,archived_at) VALUES
                ('p1','First','2026-01-01T00:00:00.000Z',?,NULL),
                ('p2','Second','2026-02-01T00:00:00.000Z',?,NULL),
                ('p3','Archived','2026-03-01T00:00:00.000Z',?,?)`,
          bind: [timestamp, timestamp, timestamp, timestamp],
          result: 'changes',
        },
        { sql: `INSERT INTO projects(id,player_id,name,created_at,updated_at) VALUES('goal-1','p1','Goal',?,?)`, bind: [timestamp, timestamp], result: 'changes' },
        { sql: `INSERT INTO todos(id,player_id,project_id,name,created_at,updated_at) VALUES('todo-1','p1','goal-1','Todo',?,?)`, bind: [timestamp, timestamp], result: 'changes' },
        { sql: `INSERT INTO tasks(id,player_id,project_id,todo_id,name,created_at,updated_at,completed_at) VALUES('task-1','p1','goal-1','todo-1','Completed',?,?,?)`, bind: [timestamp, timestamp, timestamp], result: 'changes' },
        { sql: `INSERT INTO reminders(id,player_id,title,created_at,updated_at) VALUES('reminder-1','p1','Remember',?,?)`, bind: [timestamp, timestamp], result: 'changes' },
        { sql: `INSERT INTO goal_areas(id,player_id,name,created_at,updated_at) VALUES('area-1','p1','Area',?,?)`, bind: [timestamp, timestamp], result: 'changes' },
        { sql: `INSERT INTO goal_milestones(id,player_id,goal_id,title,kind,status,created_at,updated_at) VALUES('milestone-1','p1','goal-1','Milestone','milestone','active',?,?)`, bind: [timestamp, timestamp], result: 'changes' },
        { sql: `INSERT INTO goal_links(id,player_id,goal_id,milestone_id,entity_type,entity_id,relation,created_at) VALUES('link-1','p1','goal-1','milestone-1','todo','todo-1','supports',?)`, bind: [timestamp], result: 'changes' },
        documentStatement('document_projects', 'goal-1', 'p1'),
        documentStatement('document_todos', 'todo-1', 'p1'),
        documentStatement('document_tasks', 'task-1', 'p1'),
        documentStatement('document_reminders', 'reminder-1', 'p1'),
        documentStatement('document_goal_areas', 'area-1', 'p1'),
        documentStatement('document_goal_milestones', 'milestone-1', 'p1'),
        documentStatement('document_goal_links', 'link-1', 'p1'),
      ],
    });

    await new MigrationRunner({
      client: context.client,
      migrations: [phaseOne],
      applicationVersion: 'migration-050-test-current',
    }).run();

    const memberships = await context.client.query({
      sql: 'SELECT workspace_id AS workspaceId,player_id AS playerId FROM workspace_profiles ORDER BY player_id',
      result: 'all',
    });
    assert.deepEqual(memberships.map((row) => ({ ...row })), [
      { workspaceId: 'workspace:default', playerId: 'p1' },
      { workspaceId: 'workspace:default', playerId: 'p2' },
    ]);

    for (const table of ['projects', 'todos', 'reminders', 'goal_areas', 'goal_milestones', 'goal_links']) {
      const row = await context.client.query({
        sql: `SELECT workspace_id AS workspaceId,created_by_player_id AS createdByPlayerId FROM ${table} LIMIT 1`,
        result: 'one',
      });
      assert.deepEqual({ ...row }, { workspaceId: 'workspace:default', createdByPlayerId: 'p1' }, table);
    }
    assert.equal(await context.client.query({
      sql: `SELECT workspace_id FROM tasks WHERE id='task-1'`,
      result: 'value',
    }), 'workspace:default');

    for (const table of ['document_projects', 'document_todos', 'document_tasks', 'document_reminders', 'document_goal_areas', 'document_goal_milestones', 'document_goal_links']) {
      const record = JSON.parse(await context.client.query({
        sql: `SELECT record_json FROM ${table} LIMIT 1`,
        result: 'value',
      }));
      assert.equal(record.workspaceId, 'workspace:default', table);
      if (table !== 'document_tasks') assert.equal(record.createdByPlayerId, 'p1', table);
    }

    await context.client.executeAtomic({
      commandId: 'delete-planning-creator',
      statements: [{ sql: `DELETE FROM players WHERE id='p1'`, result: 'changes' }],
    });
    for (const table of ['projects', 'todos', 'reminders', 'goal_areas', 'goal_milestones', 'goal_links']) {
      assert.equal(await context.client.query({
        sql: `SELECT player_id FROM ${table} LIMIT 1`,
        result: 'value',
      }), 'p2', `${table} should retain its shared definition`);
    }

    await assert.rejects(
      context.client.executeAtomic({
        commandId: 'delete-last-planning-profile',
        statements: [{ sql: `DELETE FROM players WHERE id='p2'`, result: 'changes' }],
      }),
      /workspace-planning-requires-live-profile/,
    );
  } finally {
    await context.close();
  }
});
