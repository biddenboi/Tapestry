import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [profile, controller, view, requirements, database] = await Promise.all([
  read('./Profile.jsx'),
  read('./ProfileDataController.js'),
  read('./ProfileView.jsx'),
  read('../../../../app/data-source/panelDomainRequirements.js'),
  read('../../../../data/persistence/DatabaseConnectionHost.js'),
]);

test('Profiles open from materialized summaries before detailed domains', () => {
  assert.match(requirements, /profiles: Object\.freeze\(\[D\.profileSummaries, D\.presence, D\.leaderboards\]\)/);
  assert.match(controller, /databaseConnection\.get\(STORES\.profileSummary, profileUUID\)/);
  assert.match(controller, /ensureDomainLoaded\?\.\(\['profiles', 'leaderboards'\]\)/);
  assert.match(controller, /databaseConnection\.getProfilePlayer\(profileUUID\)/);
  assert.match(controller, /databaseConnection\.getAllProfilePlayers\(\)/);
  assert.match(controller, /resolvedPlayer = livePlayer/);
  assert.match(controller, /const fallbackPlayer = livePlayer/);
  assert.match(controller, /summary \|\| \(fallbackPlayer \?/);
  assert.match(controller, /projectedPlayersByUUID/);
  assert.match(controller, /hasVisibleRating: projected\.hasVisibleRating/);
  assert.match(controller, /projectContributionLeaderboardAtIGT/);
  assert.match(controller, /contributionProjection\.totalsByPlayer/);
  assert.match(controller, /summary: resolvedSummary/);
  assert.doesNotMatch(profile, /resolvedProfileUUID, viewerIGTBucket\]\);/);
  assert.match(controller, /ensureDomainLoaded\('profileTimeline'\)/);
  assert.match(controller, /ensureDomainLoaded\('profileMatches'\)/);
  assert.match(controller, /ensureDomainLoaded\('profileSocial'\)/);
  assert.match(controller, /ensureDomainLoaded\('profileInventory'\)/);
  assert.doesNotMatch(requirements, /profiles: Object\.freeze\(\[[^\]]*D\.tasks/);
});

test('local profile read failures are distinct from genuinely missing profiles', () => {
  assert.match(profile, /setProfileLoadError\(true\)/);
  assert.match(profile, /Profile unavailable\./);
  assert.match(profile, /Public profile unavailable\./);
  assert.doesNotMatch(profile, /Loading profile summary/i);
});

test('rule-based narrative and replay code stay outside the initial Profile bundle', () => {
  assert.doesNotMatch(profile, /from '@domain\/profile\/ProfileBiography\.js'/);
  assert.doesNotMatch(profile, /from '@domain\/profile\/DerivedStats\.js'/);
  assert.match(profile, /import\('@domain\/profile\/ProfileNarrativeLabels\.js'\)/);
  assert.match(profile, /import\('@domain\/profile\/ProfileBiography\.js'\)/);
  assert.doesNotMatch(view, /ProfileBiography|DerivedStats/);
});

test('profile summaries update as a materialized SQLite projection', () => {
  assert.match(database, /_applyProfileSummaryMutations\(operations = \[\]\)/);
});


test('background materialized summary refresh cannot downgrade canonical fellow access', () => {
  const accessWrites = profile.match(/setProfileAccess\(data\.access\)/g) || [];
  assert.equal(accessWrites.length, 0);
  assert.match(profile, /Local visibility is owned exclusively by the canonical Social World access/);
  assert.match(profile, /loadProfileAccessData\(\{/);
  assert.match(profile, /if \(!cancelled && nextAccess\) setProfileAccess\(nextAccess\)/);
});
