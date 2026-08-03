import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCurrentIGT,
  migratePlayerIGTClock,
} from '../../../domain/time/Time.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixedNow = new Date('2026-07-12T18:00:10.000Z');

function coreFixture() {
  return {
    players: [
      {
        UUID: 'p1', username: 'Alpha', description: 'First', elo: 900, tokens: 12,
        profilePicture: { type: 'resource', resourceUUID: 'avatar-p1' },
        money: 3, minutesClearedToday: 5, inGameTime: 1000,
        createdAt: '2026-07-10T05:00:00.000Z',
        activeCosmetics: { theme: 'dreamcore', title: 'builder' }, customField: 'preserved',
      },
      {
        UUID: 'p2', username: 'Beta', elo: 1200, igtBaseElo: 1150, tokens: 30,
        createdAt: '2026-07-11T05:00:00.000Z', activeCosmetics: { theme: 'minimalist' },
      },
    ],
    appState: {
      activePlayerUUID: 'p1',
      pendingCustomization: { playerImages: { p1: 'pending' } },
      violations: { p1: { strikes: 2, igtDay: 9 } },
      banPending: { p2: true },
    },
    economyState: { globalMoney: 42.5 },
    settings: [
      { UUID: 'setting-1', parent: 'p1', settingKey: 'wake:p1', value: '07:30' },
      { UUID: 'setting-global', key: 'sound', value: true },
    ],
  };
}

test('Batch 11 imports core/profile state deterministically with golden parity', async (t) => {
  const context = await createShadowTestContext({ now: () => fixedNow });
  t.after(context.close);
  const imported = await context.shadow.importers.coreProfiles.import(coreFixture());
  assert.deepEqual(imported.counts, {
    players: 2, settings: 2, cosmetics: 3, violations: 1, banPending: 1,
    globalMoney: 42.5, diagnostics: 0,
  });

  const players = await context.shadow.coreProfiles.listPlayers();
  assert.deepEqual(players.map((player) => player.UUID), ['p2', 'p1']);
  assert.equal(players[1].igtBaseElo, 900);
  assert.equal(players[1].activeCosmetics.title, 'builder');
  assert.equal(players[1].customField, 'preserved');
  assert.deepEqual(players[1].profilePicture, { type: 'resource', resourceUUID: 'avatar-p1' });
  assert.equal(
    await context.client.query({ sql: "SELECT profile_picture FROM players WHERE id='p1'", result: 'value' }),
    '{"type":"resource","resourceUUID":"avatar-p1"}',
  );
  assert.equal(players.reduce((sum, player) => sum + player.tokens, 0), 42);
  assert.deepEqual(await context.shadow.coreProfiles.getEconomy(), { globalMoney: 42.5 });
  assert.equal(await context.client.query({ sql: 'SELECT global_money_minor FROM economy WHERE singleton_id=1', result: 'value' }), 4250);
  assert.equal((await context.shadow.coreProfiles.getCurrentPlayer()).UUID, 'p1');
  assert.deepEqual((await context.shadow.coreProfiles.getAppState()).violations.p1, { strikes: 2, igtDay: 9 });
  assert.equal((await context.shadow.coreProfiles.getSettings({ playerId: 'p1' }))[0].value, '07:30');

  const duplicate = await context.shadow.importers.coreProfiles.import(coreFixture());
  assert.equal(duplicate.duplicate, true);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM shadow_import_runs WHERE domain='core-profiles'", result: 'value' }), 1);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 11 switches profiles atomically and replays idempotently', async (t) => {
  const context = await createShadowTestContext({ now: () => fixedNow });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import(coreFixture());
  const first = await context.shadow.coreProfiles.switchProfile({
    fromPlayerId: 'p1', toPlayerId: 'p2', operationId: 'switch-1', now: fixedNow,
  });
  assert.equal(first.status, 'switched');
  const expectedIGT = getCurrentIGT(migratePlayerIGTClock({
    inGameTime: 1000,
    createdAt: '2026-07-10T05:00:00.000Z',
  }, {
    active: true,
    nowMs: fixedNow.getTime(),
  }), fixedNow.getTime());
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).inGameTime, expectedIGT);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).igtActive, false);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p2')).igtActive, true);
  assert.equal((await context.shadow.coreProfiles.getAppState()).activePlayerUUID, 'p2');

  const duplicate = await context.shadow.coreProfiles.switchProfile({
    fromPlayerId: 'p1', toPlayerId: 'p2', operationId: 'switch-1', now: fixedNow,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).inGameTime, expectedIGT);
});

test('Batch 11 ban and wipe follow the approved current-state retention policy', async (t) => {
  const context = await createShadowTestContext({ now: () => fixedNow });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import(coreFixture());
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'project-p1', parent: 'p1', name: 'Goal' }, { UUID: 'project-p2', parent: 'p2', name: 'Goal 2' }],
    todos: [{ UUID: 'todo-p1', parent: 'p1', projectId: 'project-p1', name: 'Household survives ban' }, { UUID: 'todo-p2', parent: 'p2', projectId: 'project-p2', name: 'Wiped' }],
    tasks: [{ UUID: 'task-p1', parent: 'p1', projectId: 'project-p1', name: 'Private history' }],
    reminders: [{ UUID: 'reminder-p1', parent: 'p1', title: 'Private reminder' }],
  });
  await context.shadow.importers.notes.import({ notes: [
    { UUID: 'note-p1', parent: 'p1', content: 'Protected', revision: 1, createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString(), lastOperationId: 'note-p1-import' },
    { UUID: 'note-p2', parent: 'p2', content: 'Detached on wipe', revision: 1, createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString(), lastOperationId: 'note-p2-import' },
  ] });

  const banned = await context.shadow.coreProfiles.banProfile('p1', { operationId: 'ban-p1', now: fixedNow });
  assert.equal(banned.status, 'banned');
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).username, 'Deleted User');
  assert.equal((await context.shadow.planning.listTodos('p1')).length, 0);
  assert.equal((await context.shadow.planning.listTodos('p2')).some((todo) => todo.id === 'todo-p1' || todo.UUID === 'todo-p1'), true);
  assert.equal((await context.shadow.planning.listTasks('p2')).length, 1);
  assert.equal((await context.shadow.notes.get('note-p1')).parent, null);

  await assert.rejects(
    context.shadow.coreProfiles.wipeProfile('p2', { operationId: 'wipe-last-p2', now: fixedNow }),
    (error) => error.code === 'workspace-planning-requires-live-profile',
  );
  assert.notEqual(await context.shadow.coreProfiles.getPlayer('p2'), null);
  await context.client.executeAtomic({
    commandId: 'create-fallback-profile-for-wipe',
    statements: [
      {
        sql: `INSERT INTO players(id,username,created_at,updated_at) VALUES('p3','Gamma',?,?)`,
        bind: [fixedNow.toISOString(), fixedNow.toISOString()],
        result: 'changes',
      },
      {
        sql: `INSERT INTO workspace_profiles(workspace_id,player_id,joined_at)
              VALUES('workspace:default','p3',?)`,
        bind: [fixedNow.toISOString()],
        result: 'changes',
      },
    ],
  });

  const wiped = await context.shadow.coreProfiles.wipeProfile('p2', { operationId: 'wipe-p2', now: fixedNow });
  assert.equal(wiped.status, 'wiped');
  assert.equal(await context.shadow.coreProfiles.getPlayer('p2'), null);
  assert.equal((await context.shadow.planning.listTodos('p2')).length, 0);
  assert.equal((await context.shadow.planning.listWorkspaceTodos()).length, 2);
  assert.equal((await context.shadow.planning.listWorkspaceTodos()).every((todo) => todo.parent === 'p3'), true);
  assert.equal((await context.shadow.notes.get('note-p2')).parent, null);
  const audit = await context.shadow.coreProfiles.getDeletionAudit(wiped.auditId);
  assert.equal(audit.counts.notesDetached, 1);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});
