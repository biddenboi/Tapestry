import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [layout, roomHook, room, roomController, query, feedController] = await Promise.all([
  read('./PracticeDojo.jsx'),
  read('./useDojoRoomController.js'),
  read('./DojoRoom.jsx'),
  read('../../controllers/DojoRoomController.js'),
  read('../../../../data/persistence/services/DojoRoomQueryService.js'),
  read('./usePracticeDojoController.js'),
]);

test('Room is the default sidebar pane while recommendations remain in the arena', () => {
  assert.match(layout, /useState\('room'\)/);
  assert.match(layout, /className="dojo-social-sidebar"/);
  assert.match(layout, /hidden=\{activeTab !== 'room'\}/);
  assert.match(layout, /hidden=\{activeTab !== 'standings'\}/);
  assert.match(layout, /<DojoRecommendationFeed controller=\{controller\}/);
  assert.doesNotMatch(layout, /activeTab === 'recommendations'/);
  assert.match(feedController, /createDojoVisibilityTracker/);
});

test('one prepared social scene and one bounded room join feed the roster', () => {
  assert.equal((roomHook.match(/sceneController\.load\s*\(/g) || []).length, 1);
  assert.equal((roomController.match(/getDojoRoomFacts\s*\(/g) || []).length, 1);
  assert.match(query, /FROM json_each\(\?\)/);
  assert.match(query, /MAX_DOJO_ROOM_OCCUPANTS/);
  assert.doesNotMatch(roomHook + roomController + query, /getPlayerStore\(|getAllPlayers\(|getAll\(STORES/);
});

test('room identity and inspection reuse shared social-world surfaces', () => {
  assert.match(room, /ProfileIdentity/);
  assert.match(layout, /<ProfilePresenceDrawer/);
  assert.match(layout, /onEncounterVisible=\{room\.recordVisibleEncounter\}/);
  assert.doesNotMatch(room, /recordEncounter|activeMatch/);
});
