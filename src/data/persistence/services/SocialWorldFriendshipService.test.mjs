import assert from 'node:assert/strict';
import test from 'node:test';
import SocialWorldFriendshipService from './SocialWorldFriendshipService.js';

const accepted = (id, other) => ({
  UUID: id,
  players: ['viewer', other],
  requestedBy: 'viewer',
  status: 'accepted',
  createdAt: '2026-07-14T00:00:00.000Z',
  acceptedAt: '2026-07-14T00:00:00.000Z',
});

function legacyFacade(friendships) {
  const records = new Map(friendships.map((row) => [row.UUID, row]));
  const commits = [];
  return {
    commits,
    async get(store, id) { return store === 'friendships' ? records.get(id) || null : null; },
    async getFriendshipsForPlayer(id) { return [...records.values()].filter((row) => row.players.includes(id)); },
    async getNotificationsForPlayer() { return []; },
    async commitAtomicMutation(mutation) {
      commits.push(mutation);
      for (const entry of mutation.puts || []) {
        if (entry.store === 'friendships') records.set(entry.record.UUID, entry.record);
      }
      for (const entry of mutation.deletes || []) {
        if (entry.store === 'friendships') records.delete(entry.UUID);
      }
      return { changed: true };
    },
  };
}

test('legacy compatibility acceptance uses one atomic mutation and permits the third place', async () => {
  const pending = {
    UUID: 'pending', players: ['candidate', 'viewer'], requestedBy: 'candidate', status: 'pending',
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  const facade = legacyFacade([accepted('f1', 'one'), accepted('f2', 'two'), pending]);
  const service = new SocialWorldFriendshipService({ facade });
  const result = await service.acceptFriendship({
    friendshipId: 'pending', accepterId: 'viewer', notificationId: 'accepted-notification',
    operationId: 'accept-third', acceptedAt: '2026-07-14T01:00:00.000Z',
  });
  assert.equal(result.friendship.status, 'accepted');
  assert.equal(facade.commits.length, 1);
  assert.equal(facade.commits[0].label, 'friendship-accept:accept-third');
});

test('legacy compatibility acceptance rejects a fourth place before any write', async () => {
  const pending = {
    UUID: 'pending', players: ['candidate', 'viewer'], requestedBy: 'candidate', status: 'pending',
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  const facade = legacyFacade([
    accepted('f1', 'one'), accepted('f2', 'two'), accepted('f3', 'three'), pending,
  ]);
  const service = new SocialWorldFriendshipService({ facade });
  await assert.rejects(service.acceptFriendship({
    friendshipId: 'pending', accepterId: 'viewer', notificationId: 'accepted-notification',
    operationId: 'accept-fourth',
  }), (error) => error.code === 'friend-cap-reached');
  assert.equal(facade.commits.length, 0);
});
