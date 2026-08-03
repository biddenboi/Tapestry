import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [source, presentation, standings] = await Promise.all([
  readFile(new URL('./usePracticeDojoController.js', import.meta.url), 'utf8'),
  readFile(new URL('./PracticeDojo.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./useDojoStandingsController.js', import.meta.url), 'utf8'),
]);
const settingsSource = await readFile(
  new URL('../../../settings/pages/Settings/Settings.jsx', import.meta.url),
  'utf8',
);

test('Dojo leaderboard uses bounded typed standings rather than the retired snapshot', () => {
  assert.match(presentation, /topSessions=\{standings\.top\}/);
  assert.match(standings, /getDojoStandings\(\{/);
  assert.doesNotMatch(source + presentation + standings, /DojoLeaderboardSnapshots|materializeDojoLeaderboard|sessionMap/);
});

test('Dojo request data is independent of unrelated domain revisions', () => {
  for (const unrelated of ['matches', 'recommender', 'social', 'feed', 'shop', 'inventory', 'map']) {
    assert.doesNotMatch(source, new RegExp(`domainRevisions\\.${unrelated}`));
  }
  assert.match(source, /domainRevisions\.tasks/);
  assert.doesNotMatch(source, /domainRevisions\.leaderboards/);
  assert.match(standings, /domainRevisions\.leaderboards/);
  assert.doesNotMatch(source, /domainRevisions\.profiles/);
  assert.doesNotMatch(source, /getAllPlayers\(\)/);
});

test('Settings exposes an explicit automatic-training switch', () => {
  assert.match(settingsSource, /label="Continuous Training"/);
  assert.match(settingsSource, /continuousTraining:\s*event\.target\.checked/);
  assert.match(settingsSource, /checked=\{recommenderSettings\?\.continuousTraining !== false\}/);
});

test('Dojo never presents policy propensity as recommendation confidence', () => {
  assert.doesNotMatch(source + presentation, /acceptanceProbability|confidenceFromRecommendation|% fit|dojo-feed-meter/);
  assert.match(source, /recommendationEvidenceLabel/);
  assert.match(source, /neutral-exploration/);
});

test('the recommendation and session lifecycle is extracted from presentation', () => {
  assert.match(presentation, /usePracticeDojoController\(\)/);
  assert.match(presentation, /<DojoRecommendationFeed controller=\{controller\}/);
  assert.doesNotMatch(presentation, /createTaskRecommenderWarmSession|IntersectionObserver|getPlayerStore/);
});

test('Dojo recommendations carry the exact dojo observation session', () => {
  assert.match(source, /observationSessionUUID:\s*dojoSessionUUID/);
});

test('Dojo presentation is driven by actual visibility and warm staged serving', () => {
  assert.match(source, /createDojoVisibilityTracker/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /minimumVisibleRatio:\s*0\.6/);
  assert.match(source, /minimumVisibleMs:\s*500/);
  assert.match(source, /createTaskRecommenderWarmSession/);
  assert.match(source, /warmSessionRef\.current\?\.present/);
  assert.match(source, /warmSessionRef\.current\?\.accumulateVisibility/);
  assert.doesNotMatch(source, /shownAt/);
});

test('Dojo invalidates unpresented staged cards when task context changes', () => {
  assert.match(source, /sourceMatches\(ownedTodos, \{\}, contextToken\)/);
  assert.match(source, /dojo-source-context-changed/);
  assert.match(source, /dojo-source-changed-during-scoring/);
  assert.match(source, /dojo-task-unavailable-before-presentation/);
});

test('slow scoring and rapid input cannot create parallel staged cards', () => {
  assert.match(source, /withRecommendationTimeout\(scoringPromise\)/);
  assert.match(source, /modelRequestRef\.current/);
  assert.match(source, /advancingRecommendationRef\.current/);
  assert.match(source, /warmSession\?\.stage/);
});

test('Dojo has a deferred kickoff for shared source/profile bootstrap races', () => {
  assert.match(source, /const kickoff = window\.setTimeout/);
  assert.match(source, /requestOneRecommendation\(true\)/);
  assert.match(source, /commitGenerationState\('error'\)/);
});

test('reverse scroll and unviewed exit do not author skip outcomes', () => {
  assert.match(source, /skippedItem\?\.presented && nextIndex > previousIndex/);
  assert.match(source, /const item = feedItemsRef\.current\.at\(-1\)/);
  assert.match(source, /item\?\.presented/);
  assert.match(source, /dojo-exit-unviewed/);
  assert.match(source, /warmSessionRef\.current\?\.invalidate/);
});
