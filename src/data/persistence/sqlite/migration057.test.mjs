import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '@domain/constants.js';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 057 resets only Demo Agent metrics and the shared wallet', async (t) => {
  const migration = SQLITE_MIGRATIONS.find(({ id }) => id === '057_demo_agent_reset');
  const before = SQLITE_MIGRATIONS.filter(({ id }) => id < migration.id);
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  client.applyMigrations(before, { applicationVersion: 'before-demo-reset' });
  const documents = new SqliteDocumentRepository(client);
  const at = '2026-08-04T12:00:00.000Z';

  await documents.put(STORES.player, {
    UUID: 'demo-player', username: 'Demo Agent', elo: 910, igtBaseElo: 870,
    tokens: 42, minutesClearedToday: 35, achievements: { first: { earnedAt: at } },
    selectedAchievements: ['first'], selectedAchievementsV2: ['first_movement'],
    createdAt: at, updatedAt: at,
  });
  await documents.put(STORES.player, {
    UUID: 'real-player', username: 'Real Player', elo: 1250, tokens: 99,
    minutesClearedToday: 12, createdAt: at, updatedAt: at,
  });
  await documents.put(STORES.task, {
    UUID: 'demo-task', parent: 'demo-player', name: 'Demo work', points: 70,
    pointsBase: 65, completedAt: at, updatedAt: at,
  });
  await documents.put(STORES.contribution, {
    UUID: 'demo-contribution', parent: 'demo-player', source: 'manual', value: 40,
    rewardCoins: 4, createdAt: at, updatedAt: at,
  });
  await documents.put(STORES.appSetting, {
    UUID: '__tapestry_compact_economy_state__',
    kind: 'compact-system-state',
    value: { globalMoney: 84.75 },
  });
  await client.executeAtomic({
    commandId: 'seed-demo-reset-typed',
    label: 'seed-demo-reset-typed',
    statements: [
      {
        sql: `INSERT INTO players(id,username,elo,igt_base_elo,tokens,minutes_cleared_today,in_game_time,created_at,updated_at)
              VALUES('demo-player','Demo Agent',910,870,42,35,0,?,?),('real-player','Real Player',1250,1250,99,12,0,?,?)`,
        bind: [at, at, at, at],
        result: 'changes',
      },
      {
        sql: `INSERT INTO tasks(id,player_id,name,points,points_base,created_at,updated_at,completed_at)
              VALUES('demo-task','demo-player','Demo work',70,65,?,?,?)`,
        bind: [at, at, at],
        result: 'changes',
      },
      {
        sql: `INSERT INTO contributions(id,player_id,source,value,reward_coins,created_at)
              VALUES('demo-contribution','demo-player','manual',40,4,?)`,
        bind: [at],
        result: 'changes',
      },
      {
        sql: 'INSERT INTO economy(singleton_id,global_money_minor,updated_at) VALUES(1,8475,?)',
        bind: [at],
        result: 'changes',
      },
    ],
  });

  client.applyMigrations([migration], { applicationVersion: 'demo-reset-test' });

  const demo = await documents.get(STORES.player, 'demo-player');
  const real = await documents.get(STORES.player, 'real-player');
  assert.equal(demo.elo, 0);
  assert.equal(demo.tokens, 0);
  assert.equal(demo.minutesClearedToday, 0);
  assert.deepEqual(demo.achievements, {});
  assert.deepEqual(demo.selectedAchievements, []);
  assert.deepEqual(demo.selectedAchievementsV2, []);
  assert.equal(real.elo, 1250);
  assert.equal(real.tokens, 99);
  assert.deepEqual(await client.query({
    sql: "SELECT elo,tokens,minutes_cleared_today AS minutes FROM players WHERE id='demo-player'",
    result: 'one',
  }), { elo: 0, tokens: 0, minutes: 0 });
  assert.deepEqual(await client.query({
    sql: "SELECT points,points_base AS pointsBase FROM tasks WHERE id='demo-task'",
    result: 'one',
  }), { points: 0, pointsBase: 0 });
  assert.equal(await client.query({
    sql: "SELECT value FROM contributions WHERE id='demo-contribution'",
    result: 'value',
  }), 0);
  assert.equal(await client.query({
    sql: 'SELECT global_money_minor FROM economy WHERE singleton_id=1',
    result: 'value',
  }), 0);
  assert.equal((await documents.get(STORES.appSetting, '__tapestry_compact_economy_state__')).value.globalMoney, 0);
});
