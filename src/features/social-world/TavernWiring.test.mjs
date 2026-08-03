import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [projection, scene, runtime, drawer] = await Promise.all([
  read('../../domain/social-world/TavernProjection.js'),
  read('./components/SocialWorldShell/SocialWorldScene.jsx'),
  read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('./components/TavernDrawer/TavernDrawer.jsx'),
]);

test('Taverns are pure live semantic co-presence projections', () => {
  assert.match(projection, /PRESENCE_STATE\.current/);
  assert.match(projection, /PRESENCE_STATE\.projected/);
  assert.match(projection, /occupants\.length >= 2/);
  assert.match(projection, /tavern:\$\{location\}/);
  assert.doesNotMatch(projection, /latitude|longitude|distance|gym|repository|database/i);
});

test('each location renders either one Tavern marker or individual members', () => {
  assert.match(scene, /tavern \? \(/);
  assert.match(scene, /<TavernButton/);
  assert.match(scene, /: occupants\.length \? occupants\.map/);
  assert.match(scene, /tavernByLocation/);
});

test('the bounded Tavern roster loads rich cards for every Fellow and reaches the shared drawer', () => {
  assert.match(runtime, /Promise\.all\(selectedTavern\.occupants\.map/);
  assert.doesNotMatch(runtime, /resident|occupantKind/i);
  assert.match(runtime, /profileCardController\.load/);
  assert.match(runtime, /<TavernDrawer/);
  assert.match(runtime, /onInspectProfile=\{inspectProfile\}/);
  assert.match(drawer, /card\.today\.tasks/);
  assert.match(drawer, /card\.today\.points/);
  assert.match(drawer, /Base points/);
  assert.match(drawer, /activeElapsed/);
  assert.match(drawer, /Inspect profile moment/);
  assert.doesNotMatch(drawer, /resident|data-resident/i);
});

test('Taverns remain unpersisted and unrewarded while open rosters become meaningful encounters', () => {
  const combined = `${projection}\n${scene}\n${runtime}\n${drawer}`;
  assert.doesNotMatch(combined, /createTavern|saveTavern|TavernRepository|tavernReward/);
  assert.match(runtime, /surface: 'tavern-roster'/);
  assert.match(runtime, /recordEncounter/);
});
