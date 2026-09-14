import assert from 'node:assert/strict';
import test from 'node:test';

import { STORES } from '../constants.js';
import {
  convergeSharedRitualSettings,
  saveSharedRitualSettings,
} from './SharedRitualSettings.js';

function createConnection(initialPlayers) {
  let players = structuredClone(initialPlayers);
  const commits = [];
  return {
    commits,
    async getAll(store) {
      assert.equal(store, STORES.player);
      return structuredClone(players);
    },
    async commitAtomicMutation(command) {
      commits.push(command);
      const updates = new Map(command.puts.map(({ record }) => [record.UUID, structuredClone(record)]));
      players = players.map((player) => updates.get(player.UUID) || player);
    },
    players: () => structuredClone(players),
  };
}

test('saving ritual settings copies wake and sleep checklists to every profile', async () => {
  const active = {
    UUID: 'profile-a',
    username: 'Active',
    wakeChecklist: ['Water'],
    sleepChecklist: ['Journal'],
  };
  const connection = createConnection([
    active,
    { UUID: 'profile-b', username: 'Other', wakeChecklist: ['Old'], sleepChecklist: [] },
  ]);

  const updated = await saveSharedRitualSettings(connection, active, {
    activePatch: { username: 'Renamed', wakeTime: '07:00' },
    wakeChecklist: ['Water', 'Stretch'],
    sleepChecklist: ['Journal', 'Plan tomorrow'],
    at: '2026-08-04T10:00:00.000Z',
  });

  assert.equal(connection.commits.length, 1);
  assert.equal(updated.username, 'Renamed');
  assert.equal(updated.wakeTime, '07:00');
  for (const player of connection.players()) {
    assert.deepEqual(player.wakeChecklist, ['Water', 'Stretch']);
    assert.deepEqual(player.sleepChecklist, ['Journal', 'Plan tomorrow']);
    assert.equal(player.syncUpdatedAt, '2026-08-04T10:00:00.000Z');
  }
  assert.equal(connection.players()[1].username, 'Other');
  assert.equal(connection.players()[1].wakeTime, undefined);
});

test('profile load converges older per-profile ritual settings to the active profile', async () => {
  const active = {
    UUID: 'profile-a',
    wakeChecklist: ['Hydrate'],
    sleepChecklist: ['Read'],
  };
  const connection = createConnection([
    active,
    { UUID: 'profile-b', wakeChecklist: ['Legacy'], sleepChecklist: ['Legacy'] },
  ]);

  await convergeSharedRitualSettings(connection, active);

  assert.equal(connection.commits.length, 1);
  assert.deepEqual(connection.players()[1].wakeChecklist, ['Hydrate']);
  assert.deepEqual(connection.players()[1].sleepChecklist, ['Read']);
});


test('saving unchanged settings does not rewrite any profile', async () => {
  const active = { UUID: 'a', username: 'A', wakeChecklist: ['Water'], sleepChecklist: [] };
  const connection = createConnection([active, { ...active, UUID: 'b' }]);
  await saveSharedRitualSettings(connection, active, { activePatch: { username: 'A' } });
  assert.equal(connection.commits.length, 0);
});

test('editing a name preserves newer profile data and does not rewrite other profiles', async () => {
  const stale = { UUID: 'a', username: 'Old', points: 1, wakeChecklist: [], sleepChecklist: [] };
  const connection = createConnection([{ ...stale, points: 99, description: 'Keep me' }, { ...stale, UUID: 'b' }]);
  const saved = await saveSharedRitualSettings(connection, stale, { activePatch: { username: 'New' } });
  assert.equal(saved.points, 99);
  assert.equal(saved.description, 'Keep me');
  assert.equal(connection.commits[0].puts.length, 1);
});
