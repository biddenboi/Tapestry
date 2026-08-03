import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./domainRevisions.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  DATA_DOMAIN,
  DATA_DOMAINS,
  DOMAIN_INVALIDATION,
  bumpDomainRevisions,
  createDomainRevisions,
} = await import(moduleUrl);

test('all supported data domains have an independent revision slot', () => {
  assert.deepEqual(DATA_DOMAINS, [
    'tasks',
    'recommender',
    'matches',
    'leaderboards',
    'social',
    'presence',
    'socialWorld',
    'feed',
    'journals',
    'shop',
    'inventory',
    'events',
    'eventTrackers',
    'eventBuffs',
    'goals',
    'dailyLifecycle',
    'eventAnalytics',
    'competitiveArenas',
    'achievements',
    'reminders',
    'profiles',
    'profileSummaries',
    'profileContext',
    'nextMove',
    'chronicle',
    'contributionRoad',
  ]);
  assert.deepEqual(Object.keys(createDomainRevisions()), DATA_DOMAINS);
});

test('targeted invalidation increments only named domains', () => {
  const initial = createDomainRevisions();
  const next = bumpDomainRevisions(initial, [DATA_DOMAIN.tasks, DATA_DOMAIN.recommender]);
  assert.equal(next.tasks, 1);
  assert.equal(next.recommender, 1);
  assert.equal(next.shop, 0);
  assert.equal(next.feed, 0);
  assert.equal(next.socialWorld, 0);
});

test('task writes do not invalidate Shop', () => {
  assert.ok(DOMAIN_INVALIDATION.taskWrite.includes(DATA_DOMAIN.tasks));
  assert.ok(!DOMAIN_INVALIDATION.taskWrite.includes(DATA_DOMAIN.shop));
});

test('purchases do not invalidate Feed', () => {
  assert.ok(DOMAIN_INVALIDATION.shopPurchaseCommit.includes(DATA_DOMAIN.inventory));
  assert.ok(!DOMAIN_INVALIDATION.shopPurchaseCommit.includes(DATA_DOMAIN.feed));
});

test('social updates do not invalidate Dojo scoring domains', () => {
  for (const scoringDomain of [
    DATA_DOMAIN.tasks,
    DATA_DOMAIN.recommender,
    DATA_DOMAIN.matches,
    DATA_DOMAIN.leaderboards,
    DATA_DOMAIN.profiles,
  ]) {
    assert.ok(!DOMAIN_INVALIDATION.socialWrite.includes(scoringDomain));
  }
});

test('reminder updates do not refresh profiles', () => {
  assert.ok(DOMAIN_INVALIDATION.reminderWrite.includes(DATA_DOMAIN.reminders));
  assert.ok(!DOMAIN_INVALIDATION.reminderWrite.includes(DATA_DOMAIN.profiles));
});


test('required cross-domain policies have no consumer-domain overlap', () => {
  const intersections = [
    [DOMAIN_INVALIDATION.taskWrite, [DATA_DOMAIN.shop, DATA_DOMAIN.inventory]],
    [DOMAIN_INVALIDATION.shopPurchaseCommit, [DATA_DOMAIN.feed, DATA_DOMAIN.journals, DATA_DOMAIN.social]],
    [DOMAIN_INVALIDATION.socialWrite, [
      DATA_DOMAIN.tasks,
      DATA_DOMAIN.recommender,
      DATA_DOMAIN.matches,
      DATA_DOMAIN.leaderboards,
      DATA_DOMAIN.profiles,
    ]],
    [DOMAIN_INVALIDATION.reminderWrite, [DATA_DOMAIN.profiles]],
  ];
  for (const [writeDomains, consumerDomains] of intersections) {
    assert.deepEqual(writeDomains.filter((domain) => consumerDomains.includes(domain)), []);
  }
});
