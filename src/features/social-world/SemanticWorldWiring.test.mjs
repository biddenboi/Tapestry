import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [registry, shell, runtime, scene, service, requirements, lifecycle] = await Promise.all([
  read('../../app/shell/GameHub/panelRegistry.js'),
  read('./components/SocialWorldShell/SocialWorldShell.jsx'),
  read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('./components/SocialWorldShell/SocialWorldScene.jsx'),
  read('../../data/persistence/services/SocialWorldSceneQueryService.js'),
  read('../../app/data-source/panelDomainRequirements.js'),
  read('./hooks/useSocialWorldPresenceLifecycle.js'),
]);

test('the stable world panel loads the standalone semantic world directly', () => {
  assert.match(registry, /loadSocialWorldShell/);
  assert.match(registry, /features\/social-world\/components\/SocialWorldShell/);
  assert.match(registry, /map: '@features\/social-world\/components\/SocialWorldShell\/SocialWorldShell\.jsx'/);
  assert.doesNotMatch(registry, /world-map|WorldMap|leaflet/i);
  assert.match(shell, /SocialWorldRuntime/);
  assert.doesNotMatch(runtime, /WorldMapShell|social-world-map-base/);
  assert.doesNotMatch(scene, /leaflet|OpenStreetMap|getCurrentLocation|geolocation|MapGeometry|task gym|latitude|longitude/i);
  assert.match(requirements, /map: Object\.freeze\(\[D\.profiles, D\.socialWorld, D\.social\]\)/);
});

test('the scene projects every Fellow at the current profile IGT', () => {
  assert.match(runtime, /SocialWorldSceneController/);
  assert.doesNotMatch(runtime, /useSocialOccupancy|socialOccupancy|occupancy,/);
  assert.match(runtime, /domainRevisions\.presence/);
  assert.match(runtime, /domainRevisions\.socialWorld/);
  assert.match(runtime, /domainRevisions\.social/);
  assert.match(runtime, /domainRevisions\.profiles/);
  assert.doesNotMatch(runtime, /domainRevisions\.map/);
  assert.match(runtime, /getCurrentIGT\(currentPlayer, timestamp\)/);
  assert.doesNotMatch(runtime, /setInterval/);
  assert.doesNotMatch(runtime, /setTimeout/);
  assert.doesNotMatch(scene, /databaseConnection|getAllPlayers|getAll\(/);
  assert.match(service, /getSceneSnapshot/);
  assert.match(service, /residencyService\.getResidency/);
  assert.match(service, /viewerIGT: cursor/);
  assert.doesNotMatch(service, /suppliedOccupancy|getSocialWorldOccupancySnapshot|resident/i);
  assert.doesNotMatch(lifecycle, /worldVisible/);
});

test('the semantic view includes Batch 7–8 inspection while keeping later memory slices absent', () => {
  assert.match(scene, /InactiveCastRail/);
  assert.match(runtime, /ProfilePresenceDrawer/);
  assert.match(scene, /TavernButton/);
  assert.doesNotMatch(scene, /Since You Last Saw|standings/i);
  assert.doesNotMatch(scene, /The world is quiet|Quiet right now/);
});
