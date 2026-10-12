import test from 'node:test';
import assert from 'node:assert/strict';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import MigrationRunner from './MigrationRunner.js';
import migrations from './migrations/index.js';
import { sanitizeRetiredFeatureRecord } from '../RetiredFeatureData.js';

test('Next Move retirement clears all its records without changing plans, sessions or R1 history', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  await new MigrationRunner({ client, migrations: migrations.filter((m) => m.id < '064') }).run();
  const documentTables = [
    'document_next_move_decisions', 'document_next_move_feedback', 'document_next_move_surface_preferences',
    'document_task_plan_receipts', 'document_action_sessions', 'document_r1_events', 'document_todos',
  ];
  await client.executeAtomic({ commandId: 'seed-retired-next-move', statements: [
    { sql: "INSERT INTO players(id,extra_json) VALUES('p','{\"tokens\":10}')" },
    { sql: "INSERT INTO next_move_decisions(id,player_uuid,ruleset_version,decision_point,created_at,result_type,reason_codes_json,confidence) VALUES('d','p','next_move_v1','open','2026-10-01','none','[]','high')" },
    { sql: "INSERT INTO next_move_feedback(id,decision_id,player_uuid,feedback_type,created_at) VALUES('f','d','p','not-now','2026-10-01')" },
    { sql: "INSERT INTO next_move_surface_preferences(player_uuid,placement_mode,updated_at) VALUES('p','docked','2026-10-01')" },
    ...documentTables.map((table) => ({
      sql: `INSERT INTO ${table}(uuid,record_json,sort_key,sequence) VALUES('record','{"UUID":"record","value":"keep"}','record',1)`,
    })),
  ] });
  await new MigrationRunner({ client, migrations }).run();
  for (const table of [...documentTables.slice(0, 3), 'next_move_feedback', 'next_move_decisions', 'next_move_surface_preferences']) {
    assert.equal(await client.query({ sql: `SELECT COUNT(*) FROM ${table}`, result: 'value' }), 0, table);
  }
  for (const table of documentTables.slice(3)) {
    assert.equal(await client.query({ sql: `SELECT record_json FROM ${table}`, result: 'value' }), '{"UUID":"record","value":"keep"}', table);
  }
  assert.equal(await client.query({ sql: "SELECT extra_json FROM players WHERE id='p'", result: 'value' }), '{"tokens":10}');
  for (const store of ['nextMoveDecisions', 'nextMoveFeedback', 'nextMoveSurfacePreferences']) {
    assert.equal(sanitizeRetiredFeatureRecord({ UUID: 'old' }, store), null);
  }
  assert.deepEqual(sanitizeRetiredFeatureRecord({ UUID: 'plan' }, 'taskPlanReceipts'), { UUID: 'plan' });
  assert.equal((await client.integrityCheck()).ok, true);
});
