import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMatchParticipantRoster,
  createMatchRulesSnapshot,
  getMatchTeams,
  matchSnapshotsAreIntact,
  withImmutableMatchSnapshots,
} from './MatchContracts.js';

test('match creation stores narrow immutable participant and rules snapshots', () => {
  const source = {
    UUID: 'match-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    duration: 2,
    inGameTimestamp: 50,
    teams: [[{
      UUID: 'p1', username: 'One', elo: 900, tokens: 999,
      activeCosmetics: { theme: 'gold', title: 'wayfinder', frame: 'glow' },
    }], [{ UUID: 'p2', username: 'Two', elo: 950 }]],
  };
  const match = withImmutableMatchSnapshots(source);
  assert.equal(match.participantSnapshot.participants[0].tokens, undefined);
  assert.equal(match.participantSnapshot.participants[0].playerTheme, 'gold');
  assert.equal(match.participantSnapshot.participants[0].theme, 'gold');
  assert.equal(match.participantSnapshot.participants[0].title, 'wayfinder');
  assert.equal(match.participantSnapshot.participants[0].frame, 'glow');
  assert.equal(match.participantSnapshot.participants[0].snapshotAt, source.createdAt);
  assert.ok(match.participantSnapshot.participants[0].rankLabel);
  assert.equal(match.participantSnapshot.schemaVersion, 2);
  assert.equal(match.rulesSnapshot.durationHours, 2);
  assert.equal(getMatchTeams(match)[1][0].username, 'Two');
  assert.equal(matchSnapshotsAreIntact(match), true);

  match.participantSnapshot.participants[0].username = 'Mutated';
  assert.equal(matchSnapshotsAreIntact(match), false);
});

test('snapshot helpers are deterministic for equivalent input', () => {
  const left = createMatchParticipantRoster([[{ UUID: 'a', username: 'A', elo: 10 }]], '2026-01-01T00:00:00.000Z');
  const right = createMatchParticipantRoster([[{ elo: 10, username: 'A', UUID: 'a' }]], '2026-01-01T00:00:00.000Z');
  assert.equal(left.hash, right.hash);
  assert.equal(
    createMatchRulesSnapshot({ durationHours: 1, createdAt: 'x' }).hash,
    createMatchRulesSnapshot({ createdAt: 'x', durationHours: 1 }).hash,
  );
});
