import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileIdentity } from './ProfileIdentity.js';

test('profile identity normalizes live cosmetic and rank fields', () => {
  const identity = buildProfileIdentity({
    UUID: 'p1',
    username: 'One',
    profilePicture: 'portrait',
    elo: 950,
    activeCosmetics: { title: 'wayfinder', frame: 'glow', theme: 'gold' },
  });
  assert.equal(identity.profileId, 'p1');
  assert.equal(identity.title, 'wayfinder');
  assert.equal(identity.frame, 'glow');
  assert.equal(identity.theme, 'gold');
  assert.ok(identity.rankLabel);
});

test('profile identity preserves immutable snapshot time and explicit rank label', () => {
  const identity = buildProfileIdentity({
    profileId: 'p2', username: 'Two', elo: 1200, activeTitle: 'veteran', playerTheme: 'forest',
  }, { rank: 'Archived rank', snapshotAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(identity.rankLabel, 'Archived rank');
  assert.equal(identity.title, 'veteran');
  assert.equal(identity.snapshotAt, '2026-01-01T00:00:00.000Z');
});
