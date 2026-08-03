import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFriendshipCanBeAccepted,
  buildFriendResidency,
  getFriendshipCapacity,
} from './FriendshipResidency.js';

const accepted = (id, left, right, at) => ({
  UUID: id, players: [left, right], status: 'accepted', acceptedAt: at, createdAt: at,
});

test('friend residency fills exactly three stable places and leaves vacancies empty', () => {
  const friendships = [
    accepted('f2', 'viewer', 'p2', '2026-02-01'),
    accepted('f1', 'viewer', 'p1', '2026-01-01'),
    accepted('f3', 'viewer', 'p3', '2026-03-01'),
  ];
  const residency = buildFriendResidency({
    viewerId: 'viewer', friendships,
    players: [{ UUID: 'p1' }, { UUID: 'p2', inactive: true }, { UUID: 'p3' }],
  });
  assert.deepEqual(residency.friendIds, ['p1', 'p2', 'p3']);
  assert.equal(residency.emptyFriendSlots, 0);
  assert.equal(residency.friends[1].profile.inactive, true);

  const sparse = buildFriendResidency({ viewerId: 'viewer', friendships: friendships.slice(0, 2) });
  assert.equal(sparse.friendCount, 2);
  assert.equal(sparse.emptyFriendSlots, 1);
});

test('a fourth acceptance requires an explicit relationship change for either full participant', () => {
  const friendships = ['a', 'b', 'c'].map((id, index) => (
    accepted(id, 'viewer', `p${index}`, `2026-01-0${index + 1}`)
  ));
  assert.equal(getFriendshipCapacity('viewer', friendships).isFull, true);
  assert.throws(() => assertFriendshipCanBeAccepted({
    friendship: { UUID: 'pending', players: ['viewer', 'p4'], status: 'pending' },
    friendships,
  }), (error) => error.code === 'friend-cap-reached');
  assert.doesNotThrow(() => assertFriendshipCanBeAccepted({
    friendship: { UUID: 'pending', players: ['viewer', 'p4'], status: 'pending' },
    friendships: friendships.slice(0, 2),
  }));
});

