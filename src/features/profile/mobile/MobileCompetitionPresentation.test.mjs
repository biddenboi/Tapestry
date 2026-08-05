import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileCompetitionPresentation,
  mobileRankingNeighborhood,
} from './MobileCompetitionPresentation.js';

const profiles = [
  { UUID: 'a', username: 'A', elo: 0, hasVisibleRating: false, rankGroup: 'Iron' },
  { UUID: 'b', username: 'B' },
  { UUID: 'c', username: 'C' },
  { UUID: 'd', username: 'D' },
  { UUID: 'archived', username: 'Old', archivedAt: '2026-01-01T00:00:00.000Z' },
];

test('mobile competition uses canonical snapshot values, historical profiles, leaders, and the active profile', () => {
  const model = buildMobileCompetitionPresentation({
    profiles,
    currentPlayerUUID: 'c',
    matchSnapshot: { pointsByPlayer: { a: 40, b: 30, c: 20, d: 10 } },
    contributionSnapshot: { totalsByPlayer: { d: 90, c: 80, b: 70, a: 60 } },
    matchProjection: {
      participants: [
        { UUID: 'a', elo: 1000, hasVisibleRating: true },
        { UUID: 'b', elo: 950, hasVisibleRating: true },
        { UUID: 'c', elo: 900, hasVisibleRating: true },
        { UUID: 'd', elo: 850, hasVisibleRating: true },
      ],
      eloHistory: [{ inGameTimestamp: 1, elo: 900 }],
    },
  });
  assert.deepEqual(model.neighborhoods.elo.map(({ profile }) => profile.UUID), ['a', 'b', 'c']);
  assert.deepEqual(model.neighborhoods.points.map(({ profile }) => profile.UUID), ['a', 'b', 'c']);
  assert.deepEqual(model.neighborhoods.contribution.map(({ profile }) => profile.UUID), ['d', 'c', 'b']);
  assert.deepEqual(model.metrics, { elo: 900, points: 20, contribution: 80 });
  assert.deepEqual(
    Object.fromEntries(model.profiles.slice(0, 2).map((profile) => [profile.UUID, {
      elo: profile.elo,
      hasVisibleRating: profile.hasVisibleRating,
      rankGroup: profile.rankGroup,
    }])),
    {
      a: { elo: 1000, hasVisibleRating: true, rankGroup: null },
      b: { elo: 950, hasVisibleRating: true, rankGroup: null },
    },
  );
  assert.equal(model.profiles.some(({ UUID }) => UUID === 'archived'), true);
});

test('an unrated profile never exposes its base Elo as Match Elo', () => {
  const model = buildMobileCompetitionPresentation({
    profiles: profiles.slice(0, 2),
    currentPlayerUUID: 'a',
    matchProjection: {
      participants: [
        { UUID: 'a', elo: 904, hasVisibleRating: false },
        { UUID: 'b', elo: 950, hasVisibleRating: true },
      ],
    },
  });
  assert.deepEqual(model.rankings.elo.map(({ profile }) => profile.UUID), ['b']);
  assert.equal(model.metrics.elo, null);
  assert.equal(model.profiles.find(({ UUID }) => UUID === 'a').hasVisibleRating, false);
  assert.equal(model.profiles.find(({ UUID }) => UUID === 'a').rankGroup, null);
});

test('compact rankings keep the leaders and append a distant active profile', () => {
  const rows = profiles.slice(0, 4).map((profile, index) => ({ profile, rank: index + 1 }));
  assert.deepEqual(mobileRankingNeighborhood(rows, 'a').map(({ profile }) => profile.UUID), ['a', 'b', 'c']);
  assert.deepEqual(mobileRankingNeighborhood(rows, 'd').map(({ profile }) => profile.UUID), ['a', 'b', 'c', 'd']);
});
