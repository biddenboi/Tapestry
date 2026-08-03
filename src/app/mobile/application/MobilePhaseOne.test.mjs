import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_STATE, STORES } from '../../../domain/constants.js';
import { queryMobileWorkspaceAgenda } from './MobileAgendaQueryService.js';
import { queryMobileWorkspaceGoals } from './MobileGoalsQueryService.js';
import { queryMobileShopState } from './MobileShopQueryService.js';
import {
  MOBILE_PROFILE_SWITCH_INVALIDATION,
  switchMobileProfile,
} from './MobileProfileSwitchCommand.js';

test('mobile agenda returns stable workspace definitions from every local profile', async () => {
  const stores = {
    [STORES.todo]: [
      { UUID: 'todo-a', parent: 'profile-a', name: 'A' },
      { UUID: 'todo-b', parent: 'profile-b', name: 'B' },
      { UUID: 'todo-b', parent: 'profile-b', name: 'B newer', updatedAt: '2026-08-02T12:00:00.000Z' },
      { UUID: 'foreign', parent: 'profile-c', workspaceId: 'workspace:other' },
    ],
    [STORES.project]: [
      { UUID: 'goal-a', parent: 'profile-a' },
      { UUID: 'goal-b', parent: 'profile-b' },
    ],
  };
  const databaseConnection = {
    async getAll(store) { return structuredClone(stores[store] || []); },
    async getWorkspaceReminders() {
      return [
        { UUID: 'reminder-a', parent: 'profile-a' },
        { UUID: 'reminder-b', parent: 'profile-b', workspaceId: 'workspace:default' },
      ];
    },
  };

  const first = await queryMobileWorkspaceAgenda(databaseConnection);
  const afterProfileSwitch = await queryMobileWorkspaceAgenda(databaseConnection);
  assert.deepEqual(first.tasks.map(({ UUID }) => UUID), ['todo-a', 'todo-b']);
  assert.equal(first.tasks.find(({ UUID }) => UUID === 'todo-b').name, 'B newer');
  assert.deepEqual(first.reminders.map(({ UUID }) => UUID), ['reminder-a', 'reminder-b']);
  assert.deepEqual(first.goals.map(({ UUID }) => UUID), ['goal-a', 'goal-b']);
  assert.deepEqual(
    afterProfileSwitch.tasks.map(({ UUID }) => UUID),
    first.tasks.map(({ UUID }) => UUID),
  );
});

test('mobile goals request workspace visibility while retaining the active profile for attribution', async () => {
  const calls = [];
  const overview = { activeGoals: [{ goalUUID: 'goal-a' }] };
  const databaseConnection = {
    getRepository(name) {
      assert.equal(name, 'goals');
      return {
        async getWorkspaceOverview(...args) {
          calls.push(args);
          return overview;
        },
      };
    },
  };
  assert.equal(await queryMobileWorkspaceGoals(databaseConnection, {
    playerUUID: 'profile-b',
    viewerIGT: 42,
  }), overview);
  assert.equal(calls[0][0], 'profile-b');
  assert.equal(calls[0][1], 42);
  assert.equal(calls[0][2].workspaceId, 'workspace:default');
});

test('mobile Shop keeps catalog definitions shared while inventory follows the active profile', async () => {
  const inventoryByPlayer = {
    'profile-a': [{ UUID: 'owned-a', parent: 'profile-a' }],
    'profile-b': [{ UUID: 'owned-b', parent: 'profile-b' }],
  };
  const databaseConnection = {
    getRepository(name) {
      if (name === 'shop') return {
        async getCatalog() {
          return [
            { UUID: 'shop-b', name: 'B', displayOrder: 20, parent: 'profile-b' },
            { UUID: 'shop-a', name: 'A', displayOrder: 10, parent: 'profile-a' },
          ];
        },
      };
      if (name === 'inventory') return {
        async getOwnedByPlayer(playerUUID) {
          return inventoryByPlayer[playerUUID];
        },
      };
      return null;
    },
  };

  const profileA = await queryMobileShopState(databaseConnection, { playerUUID: 'profile-a' });
  const profileB = await queryMobileShopState(databaseConnection, { playerUUID: 'profile-b' });
  assert.deepEqual(profileA.catalog.map(({ UUID }) => UUID), ['shop-b', 'shop-a']);
  assert.deepEqual(profileB.catalog.map(({ UUID }) => UUID), ['shop-b', 'shop-a']);
  assert.deepEqual(profileA.inventory.map(({ UUID }) => UUID), ['owned-a']);
  assert.deepEqual(profileB.inventory.map(({ UUID }) => UUID), ['owned-b']);
});

function profileSwitchDatabase({ activeSession = null } = {}) {
  const calls = [];
  let current = { UUID: 'profile-a', username: 'A' };
  return {
    calls,
    syncRuntime: { scheduleSync(reason) { calls.push(['sync', reason]); } },
    async getAllPlayers() {
      return [current, { UUID: 'profile-b', username: 'B', activeCosmetics: { theme: 'obsidian' } }];
    },
    async getPlayerStore(store, playerId) {
      calls.push(['sessions', store, playerId]);
      return activeSession ? [activeSession] : [];
    },
    async switchProfile(from, to) {
      calls.push(['switch', from.UUID, to]);
      current = { UUID: to, username: 'B', activeCosmetics: { theme: 'obsidian' } };
      return true;
    },
    async getCurrentPlayer() { return current; },
  };
}

test('mobile profile switching uses the canonical lifecycle and refreshes only profile-dependent domains', async () => {
  const databaseConnection = profileSwitchDatabase();
  const updated = [];
  const invalidated = [];
  const notices = [];
  const result = await switchMobileProfile({
    databaseConnection,
    currentPlayer: { UUID: 'profile-a', username: 'A' },
    targetPlayerUUID: 'profile-b',
    boundaryAuthorized: true,
    updateCurrentPlayer: (player) => updated.push(player),
    invalidateDomains: (domains) => invalidated.push(...domains),
    notify: (notice) => notices.push(notice),
  });

  assert.equal(result.changed, true);
  assert.deepEqual(databaseConnection.calls.find(([kind]) => kind === 'switch'), ['switch', 'profile-a', 'profile-b']);
  assert.equal(updated[0].UUID, 'profile-b');
  assert.deepEqual(invalidated, [...MOBILE_PROFILE_SWITCH_INVALIDATION]);
  assert.equal(invalidated.includes('tasks'), false);
  assert.equal(invalidated.includes('goals'), false);
  assert.equal(invalidated.includes('reminders'), false);
  assert.deepEqual(databaseConnection.calls.at(-1), ['sync', 'mobile-profile-switch']);
  assert.equal(notices[0].kind, 'success');
});

test('mobile profile switching cannot reattribute an active session', async () => {
  const databaseConnection = profileSwitchDatabase({
    activeSession: { UUID: 'session-a', outcome: 'active', participantProfileId: 'profile-a' },
  });
  await assert.rejects(
    switchMobileProfile({
      databaseConnection,
      currentPlayer: { UUID: 'profile-a' },
      targetPlayerUUID: 'profile-b',
      gameState: GAME_STATE.idle,
      boundaryAuthorized: true,
    }),
    (error) => error.code === 'mobile-profile-switch-session-active',
  );
  assert.equal(databaseConnection.calls.some(([kind]) => kind === 'switch'), false);
});

test('mobile profile switching is unavailable outside Start Day and End Day', async () => {
  const databaseConnection = profileSwitchDatabase();
  await assert.rejects(
    switchMobileProfile({
      databaseConnection,
      currentPlayer: { UUID: 'profile-a' },
      targetPlayerUUID: 'profile-b',
    }),
    (error) => error.code === 'mobile-profile-switch-boundary-required',
  );
  assert.equal(databaseConnection.calls.some(([kind]) => kind === 'switch'), false);
});
