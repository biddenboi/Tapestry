import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [hub, app, host, drawer, drag, placement, edgeReveal, styles, clarification, taskSessionProvider, stateBuilder, recommender, worldRoute] = await Promise.all([
  read('../../app/shell/GameHub/GameHub.jsx'),
  read('../../app/App.jsx'),
  read('./components/EdgeNextMoveHost/EdgeNextMoveHost.jsx'),
  read('./components/NextMoveDrawer/NextMoveDrawer.jsx'),
  read('./components/EdgeNextMoveHost/useDraggableNextMove.js'),
  read('./services/NextMovePlacementService.js'),
  read('./components/EdgeNextMoveHost/useEdgeReveal.js'),
  read('./components/EdgeNextMoveHost/EdgeNextMoveHost.css'),
  read('./components/TaskClarification/TaskClarification.jsx'),
  read('../tasks/context/TaskSessionProvider.jsx'),
  read('../../domain/navigation/NextMoveStateBuilder.js'),
  read('../../domain/tasks/TaskRecommender.js'),
  read('./components/WorldRecommendationRoute/WorldRecommendationRoute.jsx'),
]);

test('one persistent edge host replaces competing task recommendation surfaces', async () => {
  assert.equal((hub.match(/<EdgeNextMoveHost \/>/g) || []).length, 1);
  assert.doesNotMatch(hub, /CompactTaskTray|TaskSessionDock|ArrivalCard/);
  await assert.rejects(access(new URL('../tasks/components/CompactTaskTray/CompactTaskTray.jsx', import.meta.url)));
  await assert.rejects(access(new URL('../tasks/components/TaskSessionDock/TaskSessionDock.jsx', import.meta.url)));
});

test('the edge surface has invisible, keyboard, touch, and command entry points', () => {
  assert.match(host, /useEdgeReveal/);
  assert.match(host, /metaKey \|\| event\.ctrlKey/);
  assert.match(host, /event\.key\.toLowerCase\(\) === 'm'/);
  assert.match(host, /tapestry:open-next-move/);
  assert.match(styles, /next-move-edge-zone/);
  assert.match(styles, /next-move-access-command/);
  assert.match(styles, /@media \(max-width: 720px\), \(pointer: coarse\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(edgeReveal, /hideDelayMs = 700/);
  assert.match(edgeReveal, /onPointerEnter: keepVisible/);
  assert.match(edgeReveal, /onPointerLeave: scheduleHide/);
});

test('dragging uses pointer capture, one animation frame, clamping, and accessible alternatives', () => {
  assert.match(drag, /setPointerCapture/);
  assert.match(drag, /releasePointerCapture/);
  assert.match(drag, /requestAnimationFrame/);
  assert.match(drag, /clampNextMovePosition/);
  assert.match(drag, /ArrowLeft/);
  assert.match(drag, /ArrowRight/);
  assert.match(drag, /left: `\$\{transient\.x\}px`/);
  assert.match(drag, /transition: 'none'/);
  assert.doesNotMatch(drag, /translate3d/);
  assert.match(host, /startKeyboardMove/);
  assert.match(drawer, /dock-left/);
  assert.match(drawer, /dock-right/);
  assert.match(placement, /normalizedX/);
  assert.match(placement, /normalizedY/);
});

test('deep routes carry exact intent and world highlighting', () => {
  assert.match(app, /const \[routeIntent, setRouteIntent\]/);
  assert.match(app, /const openRoute = useCallback/);
  assert.match(app, /entityUUID/);
  assert.match(hub, /focusTaskId/);
  assert.match(hub, /data-next-move-target/);
  assert.match(worldRoute, /route\?\.locationId/);
  assert.match(worldRoute, /!route\?\.locationId/);
  assert.match(worldRoute, /worldViewportRef/);
});

test('closing and deferring invalidate pending evaluation before clearing the world route', () => {
  assert.match(host, /evaluationGenerationRef\.current \+= 1/);
  assert.match(host, /if \(type === 'not-now'\) return/);
  assert.match(host, /const notNow = useCallback/);
  assert.match(host, /onNotNow=\{notNow\}/);
});

test('bounded task clarification saves a Plan Receipt and makes failure terminal', () => {
  assert.match(clarification, /first visible action/);
  assert.match(clarification, /optional details/);
  assert.match(clarification, /createTaskPlanReceipt/);
  assert.match(clarification, /STORES\.taskPlanReceipt/);
  assert.match(taskSessionProvider, /failTaskPlanReceipt/);
});

test('unchanged candidate state receives a deterministic V12 decision seed', () => {
  assert.match(stateBuilder, /recommendationSeed/);
  assert.match(stateBuilder, /executable-set:/);
  assert.match(stateBuilder, /decisionSeed: recommendationSeed/);
  assert.match(recommender, /decisionSeed: decisionSeed \|\| uuid\(\)/);
});

test('all theme families and sharp-theme conventions are explicit', () => {
  for (const theme of [
    'old_windows',
    'pixelated',
    'gamification',
    'kawaii',
    'dreamcore',
    'minimalist_light',
    'mature_beige',
  ]) {
    assert.match(styles, new RegExp(`data-theme=\"${theme}\"`));
  }
  assert.match(styles, /--theme-card-radius/);
  assert.match(styles, /var\(--theme-enter-animation\)/);
});
