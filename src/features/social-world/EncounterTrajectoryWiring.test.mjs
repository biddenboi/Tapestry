import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [runtime, drawer, controller, persistence, methods, indexService, encounterService, profileView] = await Promise.all([
  read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('./components/ProfilePresenceDrawer/ProfilePresenceDrawer.jsx'),
  read('./controllers/SocialWorldProfileCardController.js'),
  read('../../data/persistence/PersistenceRuntime.js'),
  read('../../data/db/databaseConnectionFeatureMethods.js'),
  read('../../data/persistence/services/SocialActivityIndexService.js'),
  read('../../data/persistence/services/SocialEncounterService.js'),
  read('../profile/pages/Profile/ProfileView.jsx'),
]);

test('only rendered drawer details and open Tavern rosters record deliberate encounters', () => {
  assert.match(drawer, /onEncounterVisible/);
  assert.match(drawer, /visibleFacts: preview/);
  assert.doesNotMatch(drawer, /visibleFacts: card\.new\.facts/);
  assert.match(runtime, /surface: 'tavern-roster'/);
  assert.doesNotMatch(runtime, /onInspectProfile=.*recordVisibleEncounter/);
  assert.match(controller, /recordSocialEncounter/);
  assert.match(methods, /recordSocialEncounter/);
});

test('one derived index and receipt service own late import, update, and friendship-stable memory', () => {
  assert.match(persistence, /new SocialActivityIndexService/);
  assert.match(persistence, /new SocialEncounterService/);
  assert.match(indexService, /social_activity_dirty_subjects/);
  assert.match(indexService, /ON CONFLICT\(subject_player_id,event_kind,event_id\) DO UPDATE/);
  assert.match(encounterService, /r\.seen_version_token<>a\.version_token/);
  assert.match(encounterService, /occurred_igt<=\?/);
  assert.doesNotMatch(`${indexService}\n${encounterService}`, /journal|selectionScore|latitude|longitude/i);
});

test('trajectory remains factual in Daybook while compact context uses owner-approved projections', () => {
  assert.match(drawer, /card\.context/);
  assert.match(drawer, /Next 72 hours/);
  assert.match(drawer, /How to show up/);
  assert.doesNotMatch(drawer, /card\.thread\.state/);
  assert.match(profileView, /threadReferences/);
  assert.match(profileView, /chapter\.deltas/);
  assert.doesNotMatch(drawer, /routine|usually|probably|because they/i);
});
