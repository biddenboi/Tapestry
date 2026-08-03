import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./MatchDetailsModal.jsx', import.meta.url), 'utf8');

test('match report renders only recorded match-relative event times', () => {
  assert.match(source, /const directElapsedMs = toFiniteNumber\(event\.matchElapsedMs\)/);
  assert.doesNotMatch(source, /event\.timelineAt \|\| event\.createdAt/);
  assert.doesNotMatch(source, /new Date\(matchCreatedAt\)/);
  assert.match(source, /time: formatEventTime\(event\) \|\| 'Time not recorded'/);
});

test('match report reads the authoritative persisted event ledger', () => {
  assert.match(source, /result\.postMatchInput\?\.eventHistory/);
  assert.match(source, /id: event\.id \|\| `\$\{event\.type\}-\$\{event\.matchElapsedMs\}-\$\{index\}`/);
});

test('match report renders each participant with competition-time rank evidence', () => {
  assert.match(source, /buildCompetitionRankIdentity\(match, player\)/);
  assert.match(source, /identity=\{competitionIdentity\}/);
  assert.match(source, /Rank at match start/);
});
