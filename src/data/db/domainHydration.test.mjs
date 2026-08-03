import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./domainHydration.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  DOMAIN_DEPENDENCIES,
  DOMAIN_STORE_KEYS,
  HYDRATION_DOMAIN,
  HYDRATION_DOMAINS,
  normalizeHydrationDomains,
} = await import(moduleUrl);

test('lazy hydration exposes the requested typed domains', () => {
  for (const domain of [
    'tasks',
    'recommender',
    'matches',
    'leaderboards',
    'social',
    'feed',
    'journals',
    'shop',
    'inventory',
    'events',
    'achievements',
    'reminders',
    'profiles',
    'profileSummaries',
    'profileTimeline',
    'profileMatches',
    'profileSocial',
    'profileInventory',
    'nextMove',
    'chronicle',
  ]) {
    assert.ok(HYDRATION_DOMAINS.includes(domain), `${domain} should be independently loadable`);
  }
});

test('high-value domains own only their persistence stores', () => {
  assert.deepEqual(DOMAIN_STORE_KEYS.tasks, [
    'tasks',
    'todos',
    'projects',
    'reminders',
    'contributions',
    'taskCompletionEvents',
    'taskCompletionReceipts',
    'actionPlans',
    'actionSessions',
    'handoffs',
    'rewardProvenance',
    'worldConsequenceReceipts',
    'matchScoreEvents',
    'taskPlanReceipts',
  ]);
  assert.deepEqual(DOMAIN_STORE_KEYS.nextMove, [
    'taskPlanReceipts',
    'nextMoveDecisions',
    'nextMoveFeedback',
    'nextMoveSurfacePreferences',
  ]);
  assert.deepEqual(DOMAIN_STORE_KEYS.chronicle, [
    'chronicleEntryMetadata',
    'chronicleStories',
    'chronicleStoryEntries',
    'chronicleEntryLinks',
    'chronicleDrafts',
    'chronicleReactions',
    'chronicleFeedViewStates',
    'chronicleStoryReadStates',
    'chronicleResurfaceStates',
    'chronicleEntryAccess',
    'chronicleEntryRevisions',
    'chronicleEntryOperationReceipts',
    'chronicleEntryConflicts',
    'chronicleCollaborationOutbox',
    'chronicleLegacyNoteMappings',
  ]);
  assert.deepEqual(DOMAIN_STORE_KEYS.matches, [
    'matches',
    'backgroundJobs',
    'backgroundJobReceipts',
    'matchScoreEvents',
    'rewardProvenance',
    'worldConsequenceReceipts',
  ]);
  assert.deepEqual(DOMAIN_STORE_KEYS.social, ['friendships', 'notifications']);
  assert.deepEqual(DOMAIN_STORE_KEYS.shop, ['shop', 'transactions']);
  assert.ok(!DOMAIN_STORE_KEYS.tasks.includes('shop'));
  assert.ok(!DOMAIN_STORE_KEYS.shop.includes('journals'));
  assert.ok(!DOMAIN_STORE_KEYS.social.includes('matches'));
  assert.ok(DOMAIN_STORE_KEYS.events.includes('appSettings'));
  assert.ok(DOMAIN_STORE_KEYS.recommender.includes('appSettings'));
  assert.deepEqual(DOMAIN_STORE_KEYS.leaderboards, ['derivedCaches']);
});

test('composite domains load explicit dependencies without becoming global sync aliases', () => {
  assert.deepEqual(DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.leaderboards], []);
  assert.deepEqual(DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.achievements], ['profiles']);
  assert.deepEqual(DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.socialWorld], [
    'presence',
    'profiles',
    'tasks',
    'matches',
    'social',
    'profileContext',
  ]);
  assert.deepEqual(DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.nextMove], [
    'tasks',
    'goals',
    'reminders',
  ]);
  assert.deepEqual(DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.chronicle], ['journals']);
  assert.deepEqual(DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.feed], [
    'journals',
    'chronicle',
    'profiles',
  ]);
  assert.ok(!DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.achievements].includes('tasks'));
  assert.ok(!DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.achievements].includes('matches'));
  assert.ok(!DOMAIN_DEPENDENCIES[HYDRATION_DOMAIN.achievements].includes('events'));
  assert.ok(!Object.values(DOMAIN_DEPENDENCIES).flat().includes('shop'));
  assert.deepEqual(DOMAIN_STORE_KEYS.profileTimeline, ['transactions']);
  assert.deepEqual(DOMAIN_DEPENDENCIES.profileSocial, ['social']);
  assert.deepEqual(DOMAIN_DEPENDENCIES.profileMatches, ['matches']);
});

test('domain normalization is stable, deduplicated, and ignores unknown names', () => {
  assert.deepEqual(
    normalizeHydrationDomains(['tasks', ['matches', 'tasks'], 'unknown', null]),
    ['tasks', 'matches'],
  );
});
