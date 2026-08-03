import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [runtime, scene, rail, drawer, service, controller, persistence, methods] = await Promise.all([
  read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('./components/SocialWorldShell/SocialWorldScene.jsx'),
  read('./components/InactiveCastRail/InactiveCastRail.jsx'),
  read('./components/ProfilePresenceDrawer/ProfilePresenceDrawer.jsx'),
  read('../../data/persistence/services/SocialWorldProfileCardQueryService.js'),
  read('./controllers/SocialWorldProfileCardController.js'),
  read('../../data/persistence/PersistenceRuntime.js'),
  read('../../data/db/databaseConnectionFeatureMethods.js'),
]);

test('one compact drawer is shared by scene avatars and inactive rail rows', () => {
  assert.match(scene, /onInspectProfile/);
  assert.match(scene, /InactiveCastRail/);
  assert.match(rail, /onInspectProfile/);
  assert.match(runtime, /<ProfilePresenceDrawer/);
  assert.equal((runtime.match(/ProfilePresenceDrawer/g) || []).length >= 2, true);
  assert.match(drawer, /Now/);
  assert.match(drawer, /Next 72 hours/);
  assert.match(drawer, /Recent arc/);
  assert.match(drawer, /Current goals/);
  assert.match(drawer, /How to show up/);
  assert.match(drawer, /hasMeaningfulContext/);
  assert.doesNotMatch(drawer, /Today|Recent work|Upcoming assignments/);
  assert.match(drawer, /profile-presence-card__identity-button/);
  assert.match(drawer, /onOpenProfile\?\.\(card\.identity\.profileId\)/);
  assert.doesNotMatch(drawer, /Full permitted profile access|profile-presence-drawer__footer/);
  assert.doesNotMatch(drawer, /Batch \d+/);
});

test('recent and inactive familiar cast members are kept out of live scene locations', () => {
  assert.match(scene, /PRESENCE_STATE\.current/);
  assert.match(scene, /PRESENCE_STATE\.projected/);
  assert.match(scene, /scene\.inactiveMembers/);
  assert.doesNotMatch(scene, /presence\.state !== PRESENCE_STATE\.inactive/);
});

test('profile cards use a bounded policy-gated SQLite query with no journal bodies', () => {
  assert.match(service, /resolveProfileVisibility/);
  assert.match(service, /if \(!role \|\| access\.tier === 'outside'\) return null/);
  assert.match(service, /LIMIT 4/);
  assert.match(service, /points_base/);
  assert.match(service, /completed_in_game_timestamp<=\?/);
  assert.match(service, /td\.in_game_timestamp<=\?/);
  assert.match(service, /HAVING COUNT\(t\.id\)>=2/);
  assert.match(service, /explicitCommitment: true/);
  assert.doesNotMatch(service, /journal|body/i);
  assert.match(controller, /getSocialWorldProfileCard/);
  assert.match(persistence, /new SocialWorldProfileCardQueryService/);
  assert.match(methods, /getSocialWorldProfileCard/);
});

test('the open drawer refreshes on factual sources but shares the app clock locally', () => {
  for (const revision of ['tasks', 'matches', 'goals', 'presence', 'profiles', 'social', 'socialWorld']) {
    assert.match(runtime, new RegExp(`domainRevisions\\.${revision}`));
  }
  assert.match(runtime, /viewerIGT=\{viewerIGT\}/);
  assert.doesNotMatch(runtime, /setInterval/);
  assert.doesNotMatch(runtime, /useSocialOccupancy|resident/i);
  assert.match(drawer, /viewerIGT - card\.asOfIGT/);
});
