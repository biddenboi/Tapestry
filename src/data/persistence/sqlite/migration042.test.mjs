import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 042 separates appearance slots and clears only legacy surface references', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  const targetIndex = SQLITE_MIGRATIONS.findIndex(({ id }) => id === '042_preset_appearance_system');
  assert.ok(targetIndex > 0);
  client.applyMigrations(SQLITE_MIGRATIONS.slice(0, targetIndex), { applicationVersion: 'before-appearance' });
  await client.query({
    sql: 'INSERT INTO players(id,username,profile_picture,extra_json) VALUES(?,?,?,?)',
    bind: ['p1', 'Wayfinder', 'resource:profile-picture', '{"profilePersonalization":{"skin":"zine"}}'],
    result: 'changes',
  });
  for (const [slot, value] of [
    ['theme', 'gamification'], ['profileFrame', 'aurora'],
    ['cardBanner', { type: 'image', value: 'resource:card' }],
    ['lobbyBanner', { type: 'gradient', value: 'legacy-gradient' }],
    ['profileBanner', { type: 'color', value: '#123456' }],
    ['title', 'wayfinder'],
  ]) {
    await client.query({ sql: 'INSERT INTO player_cosmetics(player_id,slot,value_json) VALUES(?,?,?)', bind: ['p1', slot, JSON.stringify(value)], result: 'changes' });
  }

  client.applyMigrations([SQLITE_MIGRATIONS[targetIndex]], { applicationVersion: 'appearance-test' });

  const rows = await client.query({ sql: 'SELECT slot,value_json AS valueJson FROM player_cosmetics WHERE player_id=? ORDER BY slot', bind: ['p1'], result: 'all' });
  const equipment = Object.fromEntries(rows.map((row) => [row.slot, JSON.parse(row.valueJson)]));
  assert.equal(equipment.appTheme, 'gamification');
  assert.equal(equipment.profileTheme, 'gamification');
  assert.equal(equipment.profileLayout, 'zine');
  assert.equal(equipment.avatarFrame, 'aurora');
  assert.equal(equipment.matchCard, 'default');
  assert.equal(equipment.title, 'wayfinder');
  assert.equal(equipment.cardBanner, undefined);
  assert.equal(equipment.lobbyBanner, undefined);
  assert.equal(equipment.profileBanner, undefined);
  assert.equal(await client.query({ sql: 'SELECT profile_picture FROM players WHERE id=?', bind: ['p1'], result: 'value' }), 'resource:profile-picture');
  assert.equal(await client.query({ sql: 'SELECT catalog_version FROM cosmetic_migration_receipts WHERE profile_id=?', bind: ['p1'], result: 'value' }), 1);
  assert.equal(await client.query({ sql: 'SELECT catalog_id FROM contribution_road_catalog_versions WHERE catalog_version=2', result: 'value' }), 'recognition-board-and-preset-appearance-v2');
  assert.equal((await client.integrityCheck()).ok, true);
});
