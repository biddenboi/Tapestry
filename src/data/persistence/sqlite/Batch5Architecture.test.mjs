import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import SQLITE_MIGRATIONS from './migrations/index.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Batch 5 uses a forward-only cap migration and explicit residency gateways', () => {
  assert.ok(SQLITE_MIGRATIONS.some((migration) => migration.id === '021_friend_residency_visibility'));
  const migration = read('./migrations/021_friend_residency_visibility.js');
  const runtime = read('../PersistenceRuntime.js');
  const featureMethods = read('../../db/databaseConnectionFeatureMethods.js');
  assert.match(migration, /friend-cap-reached/);
  assert.match(migration, /CREATE VIEW friend_residency/);
  assert.match(runtime, /new SocialWorldResidencyService/);
  assert.match(runtime, /new SocialWorldFriendshipService/);
  assert.match(featureMethods, /getSocialWorldProfileAccess/);
  assert.match(featureMethods, /acceptSocialFriendship/);
});

test('profile presentation is policy-gated and friendship carries no reward mutation', () => {
  const profile = read('../../../features/profile/pages/Profile/Profile.jsx');
  const controller = read('../../../features/profile/pages/Profile/ProfileDataController.js');
  const visibility = read('../../../domain/social-world/ProfileVisibility.js');
  assert.match(profile, /canAccessProfileTab/);
  assert.match(profile, /access\.daybookScope === 'full'/);
  assert.match(profile, /access\.matchScope === 'full'/);
  assert.doesNotMatch(profile, /acceptedFriendDelta/);
  assert.doesNotMatch(profile, /add\(STORES\.friendship/);
  assert.match(controller, /getSocialWorldProfileAccess/);
  assert.match(visibility, /outside[\s\S]*allowedTabs: Object\.freeze\(\[PROFILE_TAB\.overview\]\)/);
});
