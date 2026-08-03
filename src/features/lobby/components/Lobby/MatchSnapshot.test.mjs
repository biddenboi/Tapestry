import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./Lobby.jsx', import.meta.url), 'utf8');

test('Pair Match creation persists fixed rules, participant, and context snapshots before reveal', () => {
  assert.match(source, /const match = withImmutableMatchSnapshots\(\{/);
  const creation = source.indexOf('const match = withImmutableMatchSnapshots({');
  const write = source.indexOf('await databaseConnection.add(STORES.match, match)', creation);
  const activate = source.indexOf('setActiveMatch(match)', write);
  assert.ok(creation >= 0 && write > creation && activate > write);
  const snapshotInput = source.slice(creation, write);
  assert.match(snapshotInput, /rulesetId: PAIR_MATCH_RULESET_ID/);
  assert.match(snapshotInput, /status: MATCH_STATUS.pending/);
  assert.match(snapshotInput, /phase: 'team-reveal'/);
  assert.match(snapshotInput, /teams,/);
  assert.match(snapshotInput, /contextSnapshot/);
  assert.match(snapshotInput, /inGameTimestamp: matchStartIGT/);
  assert.doesNotMatch(snapshotInput, /mode: matchMode/);
  assert.doesNotMatch(snapshotInput, /ratingMode: matchRatingMode/);
  assert.doesNotMatch(snapshotInput, /scoreVisibility: matchScoreVisibility/);
});
