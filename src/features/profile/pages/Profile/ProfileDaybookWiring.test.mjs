import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [profile, controller, view, worldRuntime, app, persistence, database] = await Promise.all([
  read('./Profile.jsx'),
  read('./ProfileDataController.js'),
  read('./ProfileView.jsx'),
  read('../../../social-world/components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('../../../../app/App.jsx'),
  read('../../../../data/persistence/PersistenceRuntime.js'),
  read('../../../../data/persistence/DatabaseConnectionHost.js'),
]);

test('Profile controller issues one prepared bounded Daybook query', () => {
  assert.match(controller, /databaseConnection\.getProfileDaybookPage\(\{/);
  assert.match(controller, /profileId: profileUUID/);
  assert.match(controller, /viewerIGT: currentIGT/);
  assert.match(controller, /dayLimit: 5/);
  assert.doesNotMatch(controller, /getPlayerStoreThroughIGT\(STORES\.(task|journal|event|transaction)/);
  assert.match(persistence, /new ProfileDaybookQueryService\(facade\)/);
  assert.match(database, /getProfileDaybookPage\(query\)/);
});

test('Daybook is the default Profile history presentation without changing lazy secondary tabs', () => {
  assert.match(profile, /<DaybookChapterList/);
  assert.match(profile, /loadProfileDaybookPage\(/);
  assert.match(profile, /mergeDaybookPages\(current, page\)/);
  assert.match(profile, /<span className="profile-card-title">DAYBOOK<\/span>/);
  assert.match(view, /\['activity', 'Daybook'\]/);
  assert.match(view, /<strong>\{chapter\.label\}<\/strong>/);
  assert.match(view, /Completed day/);
  assert.match(view, /wallProvenance/);
  assert.match(controller, /ensureDomainLoaded\('profileTimeline'\)/);
  assert.match(controller, /ensureDomainLoaded\('profileMatches'\)/);
  assert.match(controller, /ensureDomainLoaded\('profileSocial'\)/);
  assert.match(controller, /ensureDomainLoaded\('profileInventory'\)/);
});

test('Profile and semantic-world projections share the existing app-level minute timestamp', () => {
  assert.match(app, /useInterval\(\(\) => setTimestamp\(Date\.now\(\)\)/);
  assert.match(worldRuntime, /getCurrentIGT\(currentPlayer, timestamp\)/);
  assert.doesNotMatch(worldRuntime, /setInterval/);
  assert.doesNotMatch(worldRuntime, /SocialOccupancy|resident/i);
  assert.match(profile, /getCurrentIGT\(currentPlayer, timestamp\)/);
});

test('historical Profile replay formats its IGT coordinate locally', () => {
  assert.match(view, /formatInGameTime\(replayIGT\)/);
});
