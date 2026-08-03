import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 045 adds typed Match promise and score-finalization evidence', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());

  const targetIndex = SQLITE_MIGRATIONS.findIndex(({ id }) => id === '045_match_promise_rewards');
  assert.ok(targetIndex > 0);
  client.applyMigrations(SQLITE_MIGRATIONS.slice(0, targetIndex), {
    applicationVersion: 'before-match-promise',
  });

  const columnsBefore = await client.query({ sql: 'PRAGMA table_info(action_sessions)', result: 'all' });
  assert.equal(columnsBefore.some(({ name }) => name === 'match_reward_contract_json'), false);

  client.applyMigrations([SQLITE_MIGRATIONS[targetIndex]], {
    applicationVersion: 'match-promise-test',
  });
  const columns = await client.query({ sql: 'PRAGMA table_info(action_sessions)', result: 'all' });
  const names = new Set(columns.map(({ name }) => name));
  for (const name of [
    'match_reward_policy_version',
    'match_reward_contract_json',
    'match_score_finalized_at',
    'match_score_event_id',
    'match_score_breakdown_json',
  ]) assert.equal(names.has(name), true, name);
  assert.equal((await client.integrityCheck({ mode: 'full', reason: 'migration-045-test' })).ok, true);
});
