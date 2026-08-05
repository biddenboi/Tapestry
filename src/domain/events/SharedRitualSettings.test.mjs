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
      players = command.puts.map(({ record }) => structuredClone(record));
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
