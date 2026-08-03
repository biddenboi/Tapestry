import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const methods = await readFile(new URL('./databaseConnectionFeatureMethods.js', import.meta.url), 'utf8');
const profileController = await readFile(
  new URL('../../features/profile/pages/Profile/ProfileDataController.js', import.meta.url),
  'utf8',
);

test('friendship reads share the typed repository used by accept and decline', () => {
  const method = methods.match(/export function getFriendshipsForPlayer\(uuid\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(method, /persistenceRuntime\?\.socialRepository/);
  assert.match(method, /repository\.listFriendshipsForPlayer\(uuid\)/);
  assert.match(method, /return this\._index\(STORES\.friendship, 'players', uuid\)/);
});

test('typed friendship writes reconcile immediate profile and leaderboard read models', () => {
  const reconcile = methods.slice(
    methods.indexOf('function reconcileAuthoritativeFriendship'),
    methods.indexOf('export async function requestSocialFriendship'),
  );
  const writesStart = methods.indexOf('export async function requestSocialFriendship');
  const writes = methods.slice(
    writesStart,
    methods.indexOf('/* ═════════════════════════════════════════════════════════════════', writesStart),
  );

  assert.match(reconcile, /connection\._applyProfileSummaryMutations\?\.\(\[operation\]\)/);
  assert.match(reconcile, /connection\._queueMaterializedLeaderboardRebuild\?\.\(\[operation\], reason\)/);
  assert.match(writes, /requestSocialFriendship[\s\S]*reconcileAuthoritativeFriendship/);
  assert.match(writes, /acceptSocialFriendship[\s\S]*reconcileAuthoritativeFriendship/);
  assert.match(writes, /closeSocialFriendship[\s\S]*type: 'delete'/);
});

test('profile friendship state is loaded from the canonical typed repository', () => {
  const loader = profileController.slice(
    profileController.indexOf('export async function loadMaterializedProfileData'),
    profileController.indexOf('export async function loadProfileAccessData'),
  );

  assert.match(loader, /getFriendshipsForPlayer\(profileUUID\)/);
  assert.match(loader, /getFriendshipsForPlayer\(currentPlayer\.UUID\)/);
  assert.doesNotMatch(loader, /const relationship = \(resolved\?\.relationships/);
  assert.match(loader, /friends: players\.filter\(\(entry\) => acceptedUUIDs\.has\(entry\.UUID\)\)/);
});
