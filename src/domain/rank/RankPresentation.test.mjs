import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlayerRankPresentation } from './Rank.js';

test('stored baseline Elo does not establish a live profile rank', () => {
  const presentation = getPlayerRankPresentation({ elo: 74 });
  assert.deepEqual({
    hasVisibleRating: presentation.hasVisibleRating,
    rankLabel: presentation.rankLabel,
    rankClass: presentation.rankClass,
    rankGlow: presentation.rankGlow,
  }, {
    hasVisibleRating: false,
    rankLabel: 'Unrated',
    rankClass: 'unrated',
    rankGlow: 'none',
  });
});

test('rated-result evidence exposes the Elo-derived rank', () => {
  const presentation = getPlayerRankPresentation({
    elo: 950,
    hasVisibleRating: true,
  });
  assert.equal(presentation.rankLabel, 'PLATINUM I');
  assert.equal(presentation.rankClass, 'platinum');
  assert.equal(presentation.rankProgress, 50);
});
