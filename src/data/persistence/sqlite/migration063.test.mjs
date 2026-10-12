import test from 'node:test';
import assert from 'node:assert/strict';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import MigrationRunner from './MigrationRunner.js';
import migrations from './migrations/index.js';
import { sanitizeRetiredFeatureRecord } from '../RetiredFeatureData.js';

test('Context retirement clears stored disclosures, preserves text blocks and cannot be restored by old records', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  await new MigrationRunner({ client, migrations: migrations.filter((m) => m.id < '063') }).run();
  const profile = { UUID: 'p', tokens: 10, profilePersonalization: { blocks: [
    { id: 'old', type: 'lifeContext' }, { id: 'text', type: 'text', content: 'Keep' },
  ] } };
  await client.executeAtomic({ commandId: 'seed-retired-context', statements: [
    { sql: "INSERT INTO players(id,extra_json) VALUES('p',?)", bind: [JSON.stringify(profile)] },
    { sql: "INSERT INTO document_players(uuid,record_json,sort_key,sequence) VALUES('p',?,'p',1)", bind: [JSON.stringify(profile)] },
    { sql: "INSERT INTO document_profile_context_items(uuid,record_json,sort_key,sequence) VALUES('old-context','{\"UUID\":\"old-context\"}','old-context',1)" },
  ] });
  await new MigrationRunner({ client, migrations }).run();
  assert.equal(await client.query({ sql: 'SELECT COUNT(*) FROM document_profile_context_items', result: 'value' }), 0);
  const updated = JSON.parse(await client.query({ sql: "SELECT record_json FROM document_players WHERE uuid='p'", result: 'value' }));
  assert.deepEqual(updated.profilePersonalization.blocks.map((block) => block.type), ['text']);
  assert.equal(updated.tokens, 10);
  assert.equal(sanitizeRetiredFeatureRecord({ UUID: 'old-context' }, 'profileContextItems'), null);
  assert.deepEqual(sanitizeRetiredFeatureRecord(profile).profilePersonalization.blocks.map((block) => block.type), ['text']);
  assert.equal((await client.integrityCheck()).ok, true);
});
