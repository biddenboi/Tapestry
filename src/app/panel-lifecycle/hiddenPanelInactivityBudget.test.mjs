import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const sourcePaths = {
  feed: '../../features/feed/pages/FeedPage/FeedPage.jsx',
  shop: '../../features/shop/pages/Shop/Shop.jsx',
  lobby: '../../features/lobby/components/Lobby/Lobby.jsx',
  profiles: '../../features/profile/pages/Profile/Profile.jsx',
  notes: '../../features/quick-notes/modals/QuickNotes/QuickNotes.jsx',
  inbox: '../../features/inbox/components/Inbox/Inbox.jsx',
};
const sources = Object.fromEntries(await Promise.all(
  Object.entries(sourcePaths).map(async ([name, relativePath]) => [name, await read(relativePath)]),
));

test('all migrated panels expose an inactivity gate', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /usePanelLifecycle|useStandalonePanelLifecycle/, `${name} lifecycle gate`);
  }
});

test('hidden-panel recurring work has explicit stop or cleanup paths', () => {
  assert.match(sources.feed, /if \(!canLoad\) return/);
  assert.doesNotMatch(sources.feed, /setInterval|IntersectionObserver/);
  assert.match(sources.shop, /clearTimeout\(purchaseFlashTimerRef\.current\)/);
  assert.match(sources.lobby, /if \(!isActive\) return undefined;[\s\S]*clearInterval/);
  assert.match(sources.profiles, /resizeCleanupRef\.current\?\.\(\)/);
  assert.match(sources.notes, /cancelAutosave|flush/);
  assert.match(sources.inbox, /usePanelRequestScope/);
});
