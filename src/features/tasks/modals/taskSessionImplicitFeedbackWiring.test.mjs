import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const preview = await readFile(new URL('./TaskPreviewMenu/TaskPreviewMenu.jsx', import.meta.url), 'utf8');
const session = await readFile(new URL('./TaskSessionMenu/TaskSessionMenu.jsx', import.meta.url), 'utf8');
const expanded = await readFile(new URL('../components/TaskSessionExpanded/TaskSessionExpanded.jsx', import.meta.url), 'utf8');
const provider = await readFile(new URL('../context/TaskSessionProvider.jsx', import.meta.url), 'utf8');
const results = await readFile(new URL('./SessionResults/SessionResults.jsx', import.meta.url), 'utf8');
const activeMove = await readFile(new URL('../../../features/navigation/components/NextMoveDrawer/ActiveTaskMove.jsx', import.meta.url), 'utf8');
const matchArena = await readFile(new URL('../../../features/matches/components/MatchArena/MatchArena.jsx', import.meta.url), 'utf8');
const recommender = await readFile(new URL('../../../domain/tasks/TaskRecommender.js', import.meta.url), 'utf8');
const processors = await readFile(new URL('../domain/TaskCompletionProcessors.js', import.meta.url), 'utf8');

test('TaskPreview records ordinary navigation and acceptance before leaving the preview', () => {
  assert.doesNotMatch(preview, /DISMISS_REASON_OPTIONS|preview-reason-chip/);
  for (const label of ['Not now', 'Too long', 'Wrong project', 'Too hard', 'Too easy', 'Not interested']) {
    assert.doesNotMatch(preview, new RegExp(label, 'i'));
  }
  assert.match(preview, /await recordTaskRecommendationOutcome/);
  assert.match(preview, /await dismissRecommendationForTask/);
  assert.match(preview, /await persistRecommendationNavigation\('preview-returned-to-todo'\)/);
  assert.match(preview, /await persistRecommendationNavigation\('preview-task-deleted'\)/);
  assert.match(preview, /await persistRecommendationNavigation\('preview-overlay-closed'\)/);
  assert.match(preview, /const TaskSessionMenu = await loadTaskSessionMenu\(\)/);
});

test('TaskSession exposes factual outcomes instead of commitment or recommendation labels', () => {
  assert.match(expanded, /SessionOutcomeForm/);
  assert.match(expanded, /PAUSE/);
  assert.match(expanded, /RESUME/);
  assert.doesNotMatch(expanded, /GIVE UP|FORFEIT BONUS|COMPLETE →/);
  assert.doesNotMatch(provider, /recordTaskRecommendationSessionResult/);
  assert.match(provider, /actualDurationMs: loggedDurationMs/);
  assert.match(provider, /settleActionSession/);
  assert.match(provider, /ACTION_SESSION_OUTCOME\.completed/);
  assert.doesNotMatch(expanded, /Commitment met|reward preview|END & LOG WORK/);
  assert.match(session, /TaskSessionExpanded/);
});

test('accepted session outcomes use continuous logged work without a 30-second label boundary', () => {
  const sessionResult = recommender.slice(
    recommender.indexOf('export async function recordTaskRecommendationSessionResult'),
    recommender.indexOf('export async function dismissRecommendationForTask'),
  );
  assert.doesNotMatch(sessionResult, /30\s*\*\s*1000|meaningfulPartial|session-abandoned/);
  assert.match(sessionResult, /const outcome = completed \? 'completed' : 'partial'/);
  assert.match(processors, /'commitment-met'\s*:\s*'commitment-not-met'/);
});

test('work results explain the selected outcome and integration path', () => {
  assert.match(results, /CONTINUITY SAVED/);
  assert.match(results, /Where this went/);
  assert.match(results, /Why these rewards\?/);
  assert.match(results, /OUTCOME_COPY/);
});

test('Match scoring modifiers stay concealed across competitive task surfaces', () => {
  const competitiveSurfaces = [preview, expanded, results, activeMove, matchArena].join('\n');
  for (const implementationField of [
    'taskMultiplier',
    'eventMultiplier',
    'promiseScalar',
    'attainablePromiseScalar',
  ]) {
    assert.doesNotMatch(competitiveSurfaces, new RegExp(implementationField));
  }
  assert.match(preview, /Match scoring modifiers are concealed during competition/);
  assert.match(expanded, /Scoring modifiers stay hidden during Match play/);
  assert.match(results, /Match scoring modifiers remain concealed/);
});
