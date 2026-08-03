import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPairMatchContextSnapshot,
  createMatchParticipantRoster,
  createMatchRulesSnapshot,
  getMatchDurationMs,
  getMatchTeams,
  matchSnapshotsAreIntact,
  PAIR_MATCH_DURATION_MS,
  PAIR_MATCH_RULESET_ID,
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
      activeCosmetics: { theme: 'gamification', title: 'wayfinder', frame: 'glow' },
    }], [{ UUID: 'p2', username: 'Two', elo: 950 }]],
  };
  const match = withImmutableMatchSnapshots(source);
  assert.equal(match.participantSnapshot.participants[0].tokens, undefined);
  assert.equal(match.participantSnapshot.participants[0].playerTheme, 'gamification');
  assert.equal(match.participantSnapshot.participants[0].theme, 'gamification');
  assert.equal(match.participantSnapshot.participants[0].title, 'wayfinder');
  assert.equal(match.participantSnapshot.participants[0].frame, 'glow');
  assert.equal(match.participantSnapshot.participants[0].snapshotAt, source.createdAt);
  assert.ok(match.participantSnapshot.participants[0].rankLabel);
  assert.equal(match.participantSnapshot.schemaVersion, 3);
  assert.equal(match.participantSnapshot.participants[0].profileTheme, 'gamification');
  assert.equal(match.participantSnapshot.participants[0].matchCard, 'default');
  assert.equal(match.participantSnapshot.participants[0].standingsRow, 'default');
  assert.equal(match.rulesSnapshot.durationHours, 2);
  assert.equal(getMatchTeams(match)[1][0].username, 'Two');
  assert.equal(matchSnapshotsAreIntact(match), true);

  match.participantSnapshot.participants[0].username = 'Mutated';
  assert.equal(matchSnapshotsAreIntact(match), false);
});

test('Pair Match snapshots freeze the fixed 2v2 contract and privacy-filtered context', () => {
  const teams = [
    [{ UUID: 'viewer', username: 'Viewer', elo: 1000 }, { UUID: 'friend', username: 'Friend', elo: 1020 }],
    [{ UUID: 'opp-1', username: 'Opponent 1', elo: 1010 }, { UUID: 'opp-2', username: 'Opponent 2', elo: 990 }],
  ];
  const projections = new Map([
    ['friend', { viewerTier: 'friend', chapter: { text: 'Building a calmer week.' }, capsule: [] }],
    ['opp-1', { viewerTier: 'dynamic', capsule: [{ id: 'c1', type: 'now', text: 'Shipping a draft.' }] }],
  ]);
  const contextSnapshot = createPairMatchContextSnapshot({
    viewerUUID: 'viewer',
    teams,
    projections,
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  const match = withImmutableMatchSnapshots({
    UUID: 'pair-1',
    parent: 'viewer',
    rulesetId: PAIR_MATCH_RULESET_ID,
    createdAt: '2026-07-28T00:00:00.000Z',
    teams,
    contextSnapshot,
  });
  assert.equal(match.rulesSnapshot.rulesetId, PAIR_MATCH_RULESET_ID);
  assert.equal(match.rulesSnapshot.schemaVersion, 4);
  assert.equal(match.rulesSnapshot.scoreRewardPolicy, 'match-promise-v1');
  assert.equal(match.rulesSnapshot.maxPromiseScalar, 1.5);
  assert.equal(getMatchDurationMs(match), PAIR_MATCH_DURATION_MS);
  assert.equal(match.duration, undefined);
  assert.equal(match.ratingMode, undefined);
  assert.equal(getMatchTeams(match)[0][1].matchRole, 'teammate');
  assert.equal(getMatchTeams(match)[0][1].matchContext.chapter.text, 'Building a calmer week.');
  assert.equal(getMatchTeams(match)[1][1].matchContext, null);
  assert.equal(matchSnapshotsAreIntact(match), true);
});

test('snapshot helpers are deterministic for equivalent input', () => {
  const left = createMatchParticipantRoster([[{ UUID: 'a', username: 'A', elo: 10 }]], '2026-01-01T00:00:00.000Z');
  const right = createMatchParticipantRoster([[{ elo: 10, username: 'A', UUID: 'a' }]], '2026-01-01T00:00:00.000Z');
  assert.equal(left.hash, right.hash);
  assert.equal(
    createMatchRulesSnapshot({ durationHours: 1, createdAt: 'x' }).hash,
    createMatchRulesSnapshot({ createdAt: 'x', durationHours: 1 }).hash,
  );
  assert.equal(
    createMatchRulesSnapshot({ durationHours: 1, createdAt: 'x' }).inGameTimestamp,
    null,
  );
});
