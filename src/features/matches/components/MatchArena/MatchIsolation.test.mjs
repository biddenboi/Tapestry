import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./MatchArena.jsx', import.meta.url), 'utf8');

test('active match scoring uses only immutable snapshots and in-memory task history', () => {
  assert.match(source, /getMatchTeams\(activeMatch\)/);
  assert.match(source, /loadMatchRuntimeInput\(databaseConnection, activeMatch, currentPlayer\.UUID\)/);
  assert.match(source, /buildInMemoryMatchScores\(\{[\s\S]*taskHistory: planningHistory,[\s\S]*now: Date\.now\(\)/);
  for (const broadRead of [
    'getPlayersAtIGT',
    'getAllPlayers',
    'getAllThroughIGT',
    'getStoreFromRange',
    'getCurrentLocation',
  ]) {
    assert.doesNotMatch(source, new RegExp(broadRead));
  }
});

test('the one-second loop performs no database I/O', () => {
  const marker = source.indexOf('// The one-second loop is deliberately pure');
  const effectStart = source.indexOf('useEffect(() => {', marker);
  const nextEffect = source.indexOf('useEffect(() => {', effectStart + 1);
  assert.ok(marker >= 0 && effectStart > marker && nextEffect > effectStart, 'expected a dedicated in-memory one-second effect');
  const loop = source.slice(effectStart, nextEffect);
  assert.match(loop, /buildInMemoryMatchScores/);
  assert.doesNotMatch(loop, /databaseConnection|await |\.get\(|\.add\(|commitAtomicMutation/);
});

test('the result is published before secondary post-match jobs are queued', () => {
  const completion = source.slice(source.indexOf('const concludeMatch = useCallback'));
  const primaryCommit = completion.indexOf('await completeMatchPrimary');
  const publish = completion.indexOf('setActiveMatch(primary.match)');
  const moduleLoad = completion.indexOf("import('@domain/matches/MatchPostMatchJobs.js')");
  const queue = completion.indexOf('queuePostMatchJobs(databaseConnection, primary.match');
  assert.ok(primaryCommit >= 0 && publish > primaryCommit && moduleLoad > publish && queue > moduleLoad);
  assert.doesNotMatch(source, /import \{ queuePostMatchJobs \} from/);
  assert.doesNotMatch(source, /from '@features\/achievements';/);
  assert.match(source, /import\('@features\/achievements\/modals\/RankUpModal\/RankUpModal\.jsx'\)/);
  for (const formerCriticalWork of [
    'computeEloChanges',
    'queueAchievementEvent',
    'buildMatchHighlights',
    'getCurrentLocation',
    'queueMaterializedLeaderboardRebuild',
  ]) {
    assert.doesNotMatch(source, new RegExp(formerCriticalWork));
  }
});

test('match recommendations retain their immutable observation session', () => {
  assert.match(source, /observationSessionUUID:\s*activeMatch\.UUID/);
});
