import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileCompetitionPresentation,
  mobileRankingNeighborhood,
} from './MobileCompetitionPresentation.js';

const profiles = [
  { UUID: 'a', username: 'A' },
  { UUID: 'b', username: 'B' },
  { UUID: 'c', username: 'C' },
  { UUID: 'd', username: 'D' },
  { UUID: 'archived', username: 'Old', archivedAt: '2026-01-01T00:00:00.000Z' },
];

test('mobile competition uses canonical snapshot values and keeps the active profile in each neighborhood', () => {
  const model = buildMobileCompetitionPresentation({
    profiles,
    currentPlayerUUID: 'c',
    matchSnapshot: { pointsByPlayer: { a: 40, b: 30, c: 20, d: 10 } },
    contributionSnapshot: { totalsByPlayer: { d: 90, c: 80, b: 70, a: 60 } },
    matchProjection: {
      participants: [
        { UUID: 'a', elo: 1000 },
        { UUID: 'b', elo: 950 },
        { UUID: 'c', elo: 900 },
        { UUID: 'd', elo: 850 },
      ],
      eloHistory: [{ inGameTimestamp: 1, elo: 900 }],
    },
  });
  assert.deepEqual(model.neighborhoods.elo.map(({ profile }) => profile.UUID), ['b', 'c', 'd']);
  assert.deepEqual(model.neighborhoods.points.map(({ profile }) => profile.UUID), ['b', 'c', 'd']);
  assert.deepEqual(model.neighborhoods.contribution.map(({ profile }) => profile.UUID), ['d', 'c', 'b']);
  assert.deepEqual(model.metrics, { elo: 900, points: 20, contribution: 80 });
  assert.equal(model.profiles.some(({ UUID }) => UUID === 'archived'), false);
});

test('neighborhood bounds the first and last ranked profiles without losing them', () => {
  const rows = profiles.slice(0, 4).map((profile, index) => ({ profile, rank: index + 1 }));
  assert.deepEqual(mobileRankingNeighborhood(rows, 'a').map(({ profile }) => profile.UUID), ['a', 'b', 'c']);
  assert.deepEqual(mobileRankingNeighborhood(rows, 'd').map(({ profile }) => profile.UUID), ['b', 'c', 'd']);
});

