import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [component, hook, scene, runtime, styles, hub, legacyStyles] = await Promise.all([
  read('./WorldRecommendationRoute.jsx'),
  read('./useWorldRouteGeometry.js'),
  read('../../../social-world/components/SocialWorldShell/SocialWorldScene.jsx'),
  read('../../../social-world/components/SocialWorldShell/SocialWorldRuntime.jsx'),
  read('./WorldRecommendationRoute.css'),
  read('../../../../app/shell/GameHub/GameHub.jsx'),
  read('../EdgeNextMoveHost/EdgeNextMoveHost.css'),
]);

test('the Social World owns semantic location refs and the measured route layer', () => {
  assert.match(scene, /worldViewportRef/);
  assert.match(scene, /locationElementsRef/);
  assert.match(scene, /registerLocation/);
  assert.match(scene, /data-location=\{location\.id\}/);
  assert.match(scene, /data-next-move-destination/);
  assert.match(scene, /<WorldRecommendationRoute/);
  assert.match(runtime, /worldRoute/);
});

test('measurement responds without polling and clears stale geometry', () => {
  assert.match(hook, /getBoundingClientRect/);
  assert.match(hook, /ResizeObserver/);
  assert.match(hook, /requestAnimationFrame/);
  assert.match(hook, /MutationObserver/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /clearGeometry/);
  assert.match(hook, /cancelAnimationFrame/);
  assert.doesNotMatch(hook, /setInterval|setTimeout/);
});

test('SVG geometry and marker cores use stable CSS-pixel units', () => {
  assert.match(component, /viewBox=\{`0 0 \$\{geometry\.width\} \$\{geometry\.height\}`\}/);
  assert.match(component, /preserveAspectRatio="none"/);
  assert.match(component, /r="2"/);
  assert.match(component, /r="2\.5"/);
  assert.match(component, /r="5"/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /focusable="false"/);
  assert.match(component, /!route\?\.locationId/);
  assert.match(styles, /vector-effect: non-scaling-stroke/);
});

test('compact layout removes the free route and retains a non-color destination cue', () => {
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.world-recommendation-route\s*\{\s*display: none/);
  assert.match(styles, /data-next-move-destination='true'.*::before/s);
  assert.match(styles, /content: 'NEXT'/);
});

test('the obsolete fixed overlay and its hard-coded route rules are gone', () => {
  assert.doesNotMatch(hub, /WorldRouteOverlay/);
  assert.doesNotMatch(legacyStyles, /\.next-move-world-route/);
  assert.doesNotMatch(component, /viewBox="0 0 100 100"/);
  assert.doesNotMatch(component, /M 52 58/);
});
