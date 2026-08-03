import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydrateRankProjection,
  visibleRatingProjectionAtIGTSql,
} from './RankVisibilityProjection.js';

test('rank projection SQL uses the latest canonical materialized rated result', () => {
  const sql = visibleRatingProjectionAtIGTSql('players.id');
  assert.match(sql, /matchLeaderboardSnapshot:v1/);
  assert.match(sql, /eloTimelineByPlayer/);
  assert.match(sql, /ratedResults/);
  assert.match(sql, /completedIGT/);
  assert.match(sql, /players\.id/);
  assert.match(sql, /ORDER BY[\s\S]*completedIGT[\s\S]*DESC/);
});

test('rank hydration fails closed without evidence and projects the result Elo', () => {
  assert.deepEqual(hydrateRankProjection({ elo: 72, ratingResultJson: null }), {
    elo: 72,
    hasVisibleRating: false,
  });
  assert.deepEqual(hydrateRankProjection({
    elo: 72,
    ratingResultJson: JSON.stringify({ newElo: 124 }),
  }), {
    elo: 124,
    hasVisibleRating: true,
  });
});

test('rank visibility SQL rejects untrusted expressions', () => {
  assert.throws(() => visibleRatingProjectionAtIGTSql('players.id); DROP TABLE players;'));
});
