import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const ordinaryPaths = [
  'features/tasks/domain/TaskCompletionProcessors.js',
  'features/matches/components/MatchArena/MatchArena.jsx',
  'features/feed/modals/PostComposerModal/PostComposerModal.jsx',
  'features/feed/modals/JournalDetailModal/JournalDetailModal.jsx',
  'features/profile/pages/Profile/Profile.jsx',
  'features/shop/pages/Shop/Shop.jsx',
  'domain/events/Events.js',
];

const ordinarySources = await Promise.all(ordinaryPaths.map(read));
const processing = await read('domain/achievements/AchievementProcessing.js');
const catalog = await read('domain/achievements/Achievements.js');
const hydration = await read('data/db/domainHydration.js');
const app = await read('app/App.jsx');
const modal = await read('features/achievements/modals/AchievementsModal/AchievementsModal.jsx');

test('ordinary action paths emit targeted achievement events instead of broad scans', () => {
  for (const [index, source] of ordinarySources.entries()) {
    assert.doesNotMatch(source, /checkPassiveAchievements|checkMatchAchievements|reconcileAchievements\s*\(/, ordinaryPaths[index]);
  }
  assert.match(processing, /ACHIEVEMENT_EVENT_GROUPS/);
  assert.match(processing, /applyEventToCounters/);
  assert.match(processing, /processAchievementEvent/);
  assert.match(processing, /queueAchievementEvent/);
});

test('full achievement scans remain behind explicit reconciliation reasons only', () => {
  assert.match(catalog, /export async function reconcileAchievements/);
  assert.match(catalog, /migration/);
  assert.match(catalog, /repair/);
  assert.match(catalog, /explicit-reconciliation/);
  assert.match(catalog, /development-verification/);
  assert.doesNotMatch(catalog, /export async function checkPassiveAchievements/);
  assert.doesNotMatch(catalog, /export async function checkMatchAchievements/);
});

test('achievement hydration owns only event, counter, receipt, and profile records', () => {
  assert.match(hydration, /achievementEvents/);
  assert.match(hydration, /achievementStates/);
  assert.match(hydration, /achievementReceipts/);
  assert.match(hydration, /\[HYDRATION_DOMAIN\.achievements\]: Object\.freeze\(\[HYDRATION_DOMAIN\.profiles\]\)/);
});

test('pending achievement events recover when the achievements domain first hydrates', () => {
  assert.match(app, /recoverPendingAchievementEvents/);
  assert.match(app, /requested\.includes\('achievements'\).*recoverAchievements/s);
});


test('opening the achievements modal reads compact counters; broad reconciliation requires its explicit action', () => {
  const reconcileHandlerIndex = modal.indexOf('const handleReconcile');
  assert.ok(reconcileHandlerIndex > 0);
  const ordinaryLoad = modal.slice(0, reconcileHandlerIndex);
  const explicitHandler = modal.slice(reconcileHandlerIndex);
  assert.match(ordinaryLoad, /STORES\.achievementState/);
  assert.doesNotMatch(ordinaryLoad, /STORES\.(task|journal|event|transaction|eventLog)/);
  assert.doesNotMatch(ordinaryLoad, /reconcileAchievementState\(/);
  assert.match(explicitHandler, /reason: 'explicit-reconciliation'/);
  assert.match(explicitHandler, /STORES\.task/);
  assert.match(explicitHandler, /STORES\.journal/);
});
