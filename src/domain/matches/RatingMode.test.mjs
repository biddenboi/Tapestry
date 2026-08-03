import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./RatingMode.js', import.meta.url), 'utf8'))
  .replace("import { MATCH_STATUS } from '@domain/constants.js';", "const MATCH_STATUS = { active: 'active', complete: 'complete' };");
const { isRatedMatch, matchRatingMode, MATCH_RATING_MODE } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('explicit rating mode wins while completed legacy Elo evidence remains rated', () => {
  assert.equal(isRatedMatch({ status: 'complete', ratingMode: 'unrated' }), false);
  assert.equal(isRatedMatch({ status: 'active', ratingMode: 'rated' }), true);
  assert.equal(isRatedMatch({ status: 'complete' }), false);
  assert.equal(isRatedMatch({ status: 'active' }), false);
  assert.equal(isRatedMatch({
    status: 'complete',
    result: { oldElo: 26, newElo: 74, eloChange: 48 },
  }), true);
  assert.equal(isRatedMatch({
    status: 'complete',
    result: { eloChange: -20 },
  }), true);
  assert.equal(isRatedMatch({
    status: 'complete',
    ratingMode: 'unrated',
    result: { oldElo: 26, newElo: 74, eloChange: 48 },
  }), false);
  assert.equal(matchRatingMode({
    status: 'complete',
    result: { playerEloChangesVersion: 1, playerEloChanges: { player: { change: 4 } } },
  }), 'rated');
  assert.equal(matchRatingMode({}, MATCH_RATING_MODE.unrated), 'unrated');
});
