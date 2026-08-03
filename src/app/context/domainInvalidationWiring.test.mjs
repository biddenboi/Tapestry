import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [
  app,
  tasks,
  shop,
  feed,
  dojoScoring,
  dojoRoom,
  dojoStandings,
  profile,
  reminders,
  world,
] = await Promise.all([
  read('../App.jsx'),
  read('../../features/tasks/components/TodoList/TodoList.jsx'),
  read('../../features/shop/pages/Shop/Shop.jsx'),
  read('../../features/feed/pages/FeedPage/FeedPage.jsx'),
  read('../../features/matches/components/PracticeDojo/usePracticeDojoController.js'),
  read('../../features/matches/components/PracticeDojo/useDojoRoomController.js'),
  read('../../features/matches/components/PracticeDojo/useDojoStandingsController.js'),
  read('../../features/profile/pages/Profile/Profile.jsx'),
  read('../../features/reminders/modals/ReminderModal/ReminderModal.jsx'),
  Promise.all([
    read('../../features/social-world/components/SocialWorldShell/SocialWorldShell.jsx'),
    read('../../features/social-world/components/SocialWorldShell/SocialWorldRuntime.jsx'),
  ]).then((parts) => parts.join('\n')),
]);

test('global refresh fans out to typed domain revisions', () => {
  assert.match(app, /setDataRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(app, /bumpDomainRevisions\(revisions, DATA_DOMAINS\)/);
  assert.match(app, /domainRevisions,/);
  assert.match(app, /invalidateDomains,/);
});

test('task writes target task domains while Shop has no task revision dependency', () => {
  assert.match(tasks, /invalidateDomains\(DOMAIN_INVALIDATION\.taskWrite\)/);
  assert.match(shop, /domainRevisions\.shop/);
  assert.match(shop, /domainRevisions\.inventory/);
  assert.doesNotMatch(shop, /domainRevisions\.(?:tasks|profiles)/);
});

test('purchases target commerce domains while Feed only observes profile identity changes', () => {
  assert.match(shop, /invalidateDomains\(DOMAIN_INVALIDATION\.shopPurchaseCommit\)/);
  assert.match(feed, /domainRevisions\.chronicle/);
  assert.match(feed, /domainRevisions\.profiles/);
  assert.doesNotMatch(feed, /domainRevisions\.(?:shop|inventory)/);
});

test('social writes do not participate in Dojo scoring invalidation', () => {
  assert.match(profile, /invalidateDomains\(DOMAIN_INVALIDATION\.socialWrite\)/);
  assert.match(dojoScoring, /domainRevisions\.tasks/);
  assert.doesNotMatch(dojoScoring, /domainRevisions\.(?:leaderboards|social|socialWorld|presence|feed|journals|achievements)/);
  assert.match(dojoStandings, /domainRevisions\.leaderboards/);
  assert.match(dojoStandings, /domainRevisions\.tasks/);
  assert.match(dojoRoom, /domainRevisions\.social/);
  assert.match(dojoRoom, /domainRevisions\.socialWorld/);
  assert.match(dojoRoom, /domainRevisions\.presence/);
});

test('reminder writes do not participate in social-world refresh', () => {
  assert.match(reminders, /invalidateDomains\(DOMAIN_INVALIDATION\.reminderWrite\)/);
  assert.match(world, /domainRevisions\.socialWorld/);
  assert.doesNotMatch(world, /domainRevisions\.(?:map|reminders)/);
});
