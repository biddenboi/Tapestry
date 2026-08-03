import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [
  gameHub,
  dayBoundary,
  world,
  feed,
  shop,
  lobby,
  events,
  profile,
  notes,
  inbox,
] = await Promise.all([
  read('../shell/GameHub/GameHub.jsx'),
  read('../day-boundary/useDayBoundaryAutomation.js'),
  Promise.all([
    read('../../features/social-world/components/SocialWorldShell/SocialWorldShell.jsx'),
    read('../../features/social-world/components/SocialWorldShell/SocialWorldRuntime.jsx'),
  ]).then((parts) => parts.join('\n')),
  read('../../features/feed/pages/FeedPage/FeedPage.jsx'),
  read('../../features/shop/pages/Shop/Shop.jsx'),
  read('../../features/lobby/components/Lobby/Lobby.jsx'),
  read('../../features/events/pages/Events/Events.jsx'),
  read('../../features/profile/pages/Profile/Profile.jsx'),
  read('../../features/quick-notes/modals/QuickNotes/QuickNotes.jsx'),
  read('../../features/inbox/components/Inbox/Inbox.jsx'),
]);

test('the common lifecycle covers the first eight requested interfaces', () => {
  for (const panelId of ['map', 'feed', 'shop', 'lobby', 'events', 'profiles', 'inbox']) {
    assert.match(gameHub, new RegExp(`['"]${panelId}['"]`));
  }
  assert.match(gameHub, /usePanelLifecycleRegistry/);
  assert.match(gameHub, /PanelLifecycleProvider/);
  assert.match(notes, /useStandalonePanelLifecycle\(['"]notes['"]/);
});

test('panel work is gated or cancelled when lifecycle activity stops', () => {
  for (const source of [world, feed, shop, lobby, events, profile, inbox]) {
    assert.match(source, /usePanelLifecycle/);
  }
  assert.match(world, /runtimeActive\s*=\s*isActive/);
  assert.match(world, /if \(!runtimeActive\) return <SocialWorldStaticShell/);
  assert.match(feed, /if \(!canLoad\) return/);
  assert.doesNotMatch(feed, /setInterval|IntersectionObserver/);
  assert.match(shop, /clearTimeout\(purchaseFlashTimerRef\.current\)/);
  assert.match(lobby, /if \(!isActive\) return undefined;[\s\S]*setInterval/);
  assert.match(profile, /resizeCleanupRef\.current\?\.\(\)/);
  assert.match(notes, /if \(!canLoad\) return undefined/);
  assert.match(inbox, /usePanelRequestScope/);
});

test('reminders use known deadlines and only an explicit end-of-day receipt gates the next arrival', () => {
  assert.match(gameHub, /useScheduledDeadline/);
  assert.match(gameHub, /getNextReminderDeadline/);
  assert.match(gameHub, /getNextDailyLifecycleBoundary/);
  assert.doesNotMatch(gameHub, /useInterval|dayCheckTick|30000/);
  assert.match(dayBoundary, /Normal arrivals remain non-blocking/);
  assert.match(dayBoundary, /getDailyLifecycleLaunchState/);
  assert.match(dayBoundary, /loadWakePopup/);
  assert.match(dayBoundary, /profile-selection-required/);
  assert.match(dayBoundary, /wake-required/);
  assert.match(dayBoundary, /onGateActiveChange\?\.\(false\)/);
  assert.doesNotMatch(dayBoundary, /applyMissedDailyLifecyclePenalty/);
  assert.doesNotMatch(dayBoundary, /dayCheckTick/);
});
