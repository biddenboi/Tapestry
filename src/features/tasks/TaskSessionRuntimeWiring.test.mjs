import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [provider, menu, nextMoveHost, nextMoveDrawer, activeTaskMove, expanded, app, hub] = await Promise.all([
  read('./context/TaskSessionProvider.jsx'),
  read('./modals/TaskSessionMenu/TaskSessionMenu.jsx'),
  read('../navigation/components/EdgeNextMoveHost/EdgeNextMoveHost.jsx'),
  read('../navigation/components/NextMoveDrawer/NextMoveDrawer.jsx'),
  read('../navigation/components/NextMoveDrawer/ActiveTaskMove.jsx'),
  read('./components/TaskSessionExpanded/TaskSessionExpanded.jsx'),
  read('../../app/App.jsx'),
  read('../../app/shell/GameHub/GameHub.jsx'),
]);

test('one app-level provider owns the only task-session presentation interval', () => {
  assert.match(app, /<TaskSessionProvider>/);
  assert.match(
    app,
    /<TaskSessionProvider>[\s\S]*<NiceModal\.Provider>[\s\S]*<\/NiceModal\.Provider>[\s\S]*<\/TaskSessionProvider>/,
  );
  assert.equal((provider.match(/useInterval\s*\(/g) || []).length, 1);
  assert.doesNotMatch(menu, /useInterval|setInterval/);
  assert.doesNotMatch(nextMoveHost, /useInterval|setInterval/);
  assert.doesNotMatch(expanded, /useInterval|setInterval/);
});

test('expanded and edge surfaces consume the same provider snapshot', () => {
  assert.match(menu, /snapshot\.mode !== 'expanded'/);
  assert.match(expanded, /useTaskSession/);
  assert.match(nextMoveHost, /useTaskSession/);
  assert.match(nextMoveDrawer, /ActiveTaskMove/);
  assert.match(activeTaskMove, /next-move-active-task/);
  assert.match(activeTaskMove, /Open full session/);
  assert.match(nextMoveDrawer, /onExpand=\{taskSession\.expand\}/);
  assert.match(nextMoveHost, /taskSession\.snapshot\?\.mode === 'docked'/);
  assert.match(nextMoveHost, /surface === 'active-session'/);
  assert.match(nextMoveHost, /previousSessionUUID && !activeSessionUUID/);
  assert.match(nextMoveHost, /explicitlyOpenedRef\.current/);
  assert.match(nextMoveDrawer, /Ready for a new move/);
  assert.match(nextMoveHost, /hiddenForFocusSurface = gameState !== GAME_STATE\.idle && !activeTaskSurface/);
  assert.match(hub, /<EdgeNextMoveHost \/>/);
  assert.doesNotMatch(hub, /<TaskSessionDock \/>/);
  assert.match(expanded, /canMinimize && <button/);
  assert.doesNotMatch(expanded, /sourceGameState !== GAME_STATE\.dojo/);
  assert.match(activeTaskMove, /onSettle/);
});

test('settlement stays canonical, guarded, and source-stable after a Match concludes', () => {
  assert.match(provider, /new TaskSessionController\(\{ completeTask \}\)/);
  assert.match(provider, /settlementOperationId/);
  assert.match(provider, /sourceGameState/);
  assert.match(provider, /record\.matchUUID \|\| record\.source === 'match'/);
  assert.match(provider, /canMinimize: sourceGameState !== GAME_STATE\.dojo && !sourceDojoSessionUUID/);
  assert.match(provider, /mode: mode === 'docked' && !current\.canMinimize \? 'expanded' : mode/);
  assert.match(provider, /gameState: current\.sourceGameState/);
  assert.match(provider, /actualDurationMs: loggedDurationMs/);
  assert.match(provider, /settleActionSession/);
  assert.match(provider, /actionSessionUUID: current\.actionSessionUUID/);
  assert.match(provider, /match: current\.sourceGameState === GAME_STATE\.match/);
});

test('unfinished Match sessions recover the Match and reopen the expanded task surface', () => {
  assert.match(provider, /ensureDomainLoaded\(\['tasks', 'matches'\]\)/);
  assert.match(provider, /resolveRestorableMatchSession/);
  assert.match(provider, /setActiveMatch\(restorableMatch\)/);
  assert.match(provider, /setGameState\(GAME_STATE\.match\)/);
  assert.match(provider, /replacePanel\(null\)/);
  assert.match(provider, /restoredFromContinuity/);
  assert.match(provider, /mode: 'expanded'/);
  assert.match(provider, /loadTaskSessionMenu\(\)/);
  assert.match(provider, /NiceModal\.show\(TaskSessionMenu\)/);
});
