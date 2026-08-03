import assert from 'node:assert/strict';
import test from 'node:test';
import MigrationRunner from './MigrationRunner.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';

test('schema 29 migrates Goals to schema 30 without changing UUIDs', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  const oldMigrations = SQLITE_MIGRATIONS.filter((migration) => migration.id < '030_goal_system');
  await new MigrationRunner({ client, migrations: oldMigrations }).run();
  await client.executeAtomic({
    commandId: 'seed-schema-29-goal',
    label: 'seed-schema-29-goal',
    statements: [
      {
        sql: `INSERT INTO players(id,username,created_at,in_game_time,extra_json)
              VALUES('player-1','Player','2026-07-01T00:00:00.000Z',0,'{}')`,
        result: 'changes',
      },
      {
        sql: `INSERT INTO projects(id,player_id,name,description,status,created_at,in_game_timestamp,extra_json)
              VALUES('goal-1','player-1','Legacy Goal','A legacy description','active','2026-07-01T00:00:00.000Z',4,'{}')`,
        result: 'changes',
      },
    ],
  });
  const migration030 = SQLITE_MIGRATIONS.find((migration) => migration.id === '030_goal_system');
  await new MigrationRunner({ client, migrations: [migration030] }).run();
  const project = await client.query({
    sql: `SELECT id,json_extract(extra_json,'$.progressType') AS progressType,
                 json_extract(extra_json,'$.finishCondition') AS finishCondition
          FROM projects WHERE id='goal-1'`,
    result: 'one',
  });
  const participant = await client.query({
    sql: `SELECT goal_id AS goalUUID,player_id AS playerUUID,role
          FROM goal_participants WHERE goal_id='goal-1'`,
    result: 'one',
  });
  const documentTable = await client.query({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='document_goal_milestones'",
    result: 'one',
  });
  assert.deepEqual(project, {
    id: 'goal-1',
    progressType: 'milestones',
    finishCondition: 'A legacy description',
  });
  assert.deepEqual(participant, {
    goalUUID: 'goal-1',
    playerUUID: 'player-1',
    role: 'owner',
  });
  assert.equal(documentTable.name, 'document_goal_milestones');
});
