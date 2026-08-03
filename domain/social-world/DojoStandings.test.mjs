import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDojoStandings } from './DojoStandings.js';

function row(playerId, overrides = {}) {
  return {
    sessionId: `session-${playerId}`,
    playerId,
    identity: { profileId: playerId, username: playerId },
    points: 0,
    status: 'provisional',
    boundaryClaim: 'exact',
    position: null,
    ...overrides,
  };
}

test('standings preserve explicit self, friend, cast, and provisional context', () => {
  const members = [
    { profileId: 'self', role: 'self', identity: { profileId: 'self', username: 'Ada' } },
    { profileId: 'friend', role: 'friend', identity: { profileId: 'friend', username: 'Eli' } },
    { profileId: 'peer', role: 'near-peer', identity: { profileId: 'peer', username: 'Sol' } },
  ];
  const projected = projectDojoStandings({
    current: row('self'),
    around: [row('friend', { position: 4, status: 'complete' }), row('self'), row('peer', { position: 6 })],
  }, {
    viewer: { profileId: 'self' },
    memberById: new Map(members.map((member) => [member.profileId, member])),
  });

  assert.equal(projected.current.isViewer, true);
  assert.equal(projected.current.rankLabel, 'Updating');
  assert.equal(projected.current.sessionLabel, 'Provisional · no points yet');
  assert.equal(projected.around[0].contextLabel, 'Friend');
  assert.equal(projected.around[2].contextLabel, 'Current cast');
  assert.equal(projected.around[0].identity.username, 'Eli');
});

test('legacy partial sessions never invent a duration claim', () => {
  const projected = projectDojoStandings({
    current: row('self', { status: 'complete', boundaryClaim: 'partial', points: 30, position: 8 }),
  }, { viewer: { profileId: 'self' }, memberById: new Map() });
  assert.equal(projected.current.sessionLabel, 'Historical session · duration unavailable');
  assert.equal(projected.current.rankLabel, '#8');
});
