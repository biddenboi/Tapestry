import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileIdentity } from './ProfileIdentity.js';

test('profile identity normalizes live cosmetic and rank fields', () => {
  const identity = buildProfileIdentity({
    UUID: 'p1',
    username: 'One',
    profilePicture: 'portrait',
    elo: 950,
    activeCosmetics: { title: 'wayfinder', frame: 'glow', theme: 'gamification' },
  });
  assert.equal(identity.profileId, 'p1');
  assert.equal(identity.title, 'wayfinder');
  assert.equal(identity.frame, 'glow');
  assert.equal(identity.theme, 'gamification');
  assert.equal(identity.hasVisibleRating, false);
  assert.equal(identity.rankLabel, 'Unrated');
});

test('profile identity exposes a rank only with rated-result evidence', () => {
  const identity = buildProfileIdentity({
    UUID: 'rated',
    username: 'Rated',
    elo: 950,
    hasVisibleRating: true,
  });
  assert.equal(identity.hasVisibleRating, true);
  assert.equal(identity.rankLabel, 'PLATINUM I');
});

test('profile identity preserves immutable snapshot time and explicit rank label', () => {
  const identity = buildProfileIdentity({
    profileId: 'p2', username: 'Two', elo: 1200, activeTitle: 'veteran', playerTheme: 'forest',
  }, { rank: 'Archived rank', snapshotAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(identity.rankLabel, 'Archived rank');
  assert.equal(identity.title, 'veteran');
  assert.equal(identity.snapshotAt, '2026-01-01T00:00:00.000Z');
});

test('profile identity tolerates the transient null between profile hydrations', () => {
  const identity = buildProfileIdentity(null);
  assert.equal(identity.profileId, null);
  assert.equal(identity.username, 'Unknown profile');
  assert.equal(identity.rankLabel, 'Unrated');
});
