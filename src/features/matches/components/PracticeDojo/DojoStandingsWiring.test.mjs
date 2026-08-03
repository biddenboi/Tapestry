import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [layout, hook, view, service, migration, presence, processors, runtime, roomHook] = await Promise.all([
  read('./PracticeDojo.jsx'),
  read('./useDojoStandingsController.js'),
  read('./DojoStandings.jsx'),
  read('../../../../data/persistence/services/DojoStandingsService.js'),
  read('../../../../data/persistence/sqlite/migrations/023_dojo_session_standings.js'),
  read('../../../../data/persistence/sqlite/SqliteSocialWorldRepository.js'),
  read('../../../tasks/domain/TaskCompletionProcessors.js'),
  read('../../../../data/persistence/PersistenceRuntime.js'),
  read('./useDojoRoomController.js'),
]);

test('Room and Standings remain mounted in the social sidebar', () => {
  assert.match(layout, /useState\('room'\)/);
  assert.match(layout, /className="dojo-social-sidebar"/);
  for (const tab of ['room', 'standings']) {
    assert.match(layout, new RegExp(`hidden=\\{activeTab !== '${tab}'\\}`));
  }
  assert.match(layout, /<DojoStandings[\s\S]*?controller=\{standings\}/);
  assert.match(layout, /topSessions=\{standings\.top\}/);
  assert.match(view, /<DojoTopSessions[\s\S]*?sessions=\{topSessions\}/);
  assert.match(view, /className=\{`dojo-standing-row[\s\S]*?role="button"[\s\S]*?onClick=\{inspect\}/);
  assert.match(view, /className=\{`dojo-lb-row[\s\S]*?onClick=\{\(\) => onInspectProfile\?\.\(session\.playerId\)\}/);
  assert.doesNotMatch(layout, /setGameState\([^)]*standings/);
});

test('indexed standings keep reads bounded and materialization deterministic', () => {
  assert.match(migration, /CREATE TABLE dojo_session_rollups/);
  assert.match(migration, /CREATE UNIQUE INDEX dojo_session_ranks_position_idx/);
  assert.match(service, /WITH mine AS/);
  assert.match(service, /r\.position BETWEEN MAX\(1,mine\.position-\?\) AND mine\.position\+\?/);
  assert.match(service, /LIMIT \?/);
  assert.match(service, /ROW_NUMBER\(\) OVER \(ORDER BY points DESC,ended_igt DESC,session_id\)/);
  assert.match(service, /requestIdleCallback\(callback, \{ timeout: 1000 \}\)/);
  assert.doesNotMatch(service + hook, /getAll\(|getAllPlayers\(|getPlayerStore\(/);
});

test('presence boundaries and completion processing maintain the typed rollup', () => {
  assert.match(presence, /openDojoRollupStatement/);
  assert.match(presence, /finalizeDojoRollupStatement/);
  assert.match(presence, /focused_ms=focused_ms\+\?/);
  assert.match(processors, /recordDojoStandingCompletion/);
  assert.match(runtime, /new DojoStandingsService/);
  assert.match(service, /commandId: `dojo-rollup-task:\$\{taskId\}`/);
  assert.doesNotMatch(service, /ensureLegacyParity\(\)/);
});

test('the competitive view distinguishes provisional, historical, friend, cast, and self context', () => {
  assert.match(view, /Provisional · no points yet/);
  assert.match(view, /data-session-status=\{row\.status\}/);
  assert.match(view, /row\.isFriend \? 'FRIEND' : 'CAST'/);
  assert.match(view, /CURRENT SESSION/);
  assert.match(view, /AROUND YOU/);
  assert.match(hook, /currentSessionId: dojoSessionUUID/);
  assert.match(roomHook, /if \(!member\) \{[\s\S]*?openPanel\('profile', profileId\)/);
});
