import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [lobby, requirements, database, leaderboards, importExport, dojo, dojoStandings, dojoStandingsView] = await Promise.all([
  read('./Lobby.jsx'),
  read('../../../../app/data-source/panelDomainRequirements.js'),
  read('../../../../data/persistence/DatabaseConnectionHost.js'),
  read('../../../../domain/leaderboards/MaterializedLeaderboards.js'),
  read('../../../../data/persistence/services/ImportExportService.js'),
  read('../../../matches/components/PracticeDojo/PracticeDojo.jsx'),
  read('../../../matches/components/PracticeDojo/useDojoStandingsController.js'),
  read('../../../matches/components/PracticeDojo/DojoStandings.jsx'),
]);

test('Lobby opening reads materialized data plus one prepared social scene', () => {
  assert.match(requirements, /lobby: Object\.freeze\(\[D\.leaderboards, D\.socialWorld, D\.social\]\)/);
  assert.match(lobby, /readLobbyMaterializedData\(databaseConnection, currentPlayer\.UUID, lobbyViewerIGT\)/);
  assert.equal((lobby.match(/socialSceneController\.load\s*\(/g) || []).length, 1);

  const start = lobby.indexOf('const load = async () => {');
  const end = lobby.indexOf('useEffect(() => {', start + 1);
  assert.ok(start >= 0 && end > start, 'expected the opening snapshot effect');
  const openingEffect = lobby.slice(start, end);
  for (const broadRead of [
    'getAllThroughIGT',
    'getPlayersAtIGT',
    'getPlayerStore(',
    'getVisibleMatchesForPlayer',
    'getFriendshipsForPlayer',
  ]) {
    assert.doesNotMatch(openingEffect, new RegExp(broadRead.replace('(', '\\(')));
  }
  assert.doesNotMatch(lobby, /leaderboardHour|Math\.floor\(viewerIGT \/ HOUR\)/);
});

test('Elo graph includes self and restricts comparison journeys to live Fellows at current IGT', () => {
  assert.match(lobby, /visibleFellowRatings/);
  assert.match(lobby, /socialScene\?\.members/);
  assert.match(lobby, /data=\{eloHistory\}/);
  assert.match(lobby, /seriesLabel=\{`\$\{username\} \(You\)`\}/);
  assert.match(lobby, /comparisonRatings=\{viewerHasVisibleRating \? visibleFellowRatings : \[\]\}/);
  assert.match(lobby, /You\{visibleFellowRatings\.length > 0/);
  assert.match(lobby, /through current IGT/);
  assert.doesNotMatch(lobby, /including deterministic Match Fellows/);
});

test('Lobby profile Points and Top Points use the same whole direct-work ledger', () => {
  assert.match(lobby, /setTotalPoints\(data\.totalPoints\)/);
  assert.match(lobby, /setPlayerPoints\(data\.match\.pointsByPlayer \|\| \{\}\)/);
  assert.match(lobby, /Math\.floor\(totalPoints\)\.toLocaleString\(\)/);
  assert.match(lobby, /Math\.floor\(playerPoints\[p\.UUID\] \|\| 0\)/);
  assert.doesNotMatch(lobby, /TODAY PTS/);
});

test('explicit Lobby actions hydrate their complete domains only when invoked', () => {
  assert.match(lobby, /handleFindMatch[\s\S]*ensureDomainLoaded\(\['matches', 'tasks', 'profiles', 'dailyLifecycle'\]\)/);
  assert.match(lobby, /openMatchDetails[\s\S]*ensureDomainLoaded\('matches'\)/);
  assert.match(lobby, /openTaskCreationPopup[\s\S]*ensureDomainLoaded\('tasks'\)/);
  assert.match(lobby, /ensureDomainLoaded\(\['profiles', 'tasks', 'journals', 'feed', 'events', 'matches', 'shop'\]\)/);
});

test('leaderboard rebuilds are commit-driven and preserve the old snapshot while pending', () => {
  assert.match(database, /_queueMaterializedLeaderboardRebuild\(stagedOperations, label\)/);
  assert.match(database, /queueLeaderboardRebuildForOperations\(this, committedOperations, reason\)/);
  assert.match(leaderboards, /requestIdleCallback\(callback, \{ timeout: 1000 \}\)/);
  assert.match(leaderboards, /commitAtomicMutation\(\{\s*label: 'materialized-leaderboard-rebuild'/);
  assert.match(lobby, /MATERIALIZED_LEADERBOARDS_REBUILDING_EVENT/);
  assert.match(lobby, /setLeaderboardsUpdating\(true\)/);
  assert.doesNotMatch(lobby, /handleRebuilding[\s\S]{0,160}setMatchHistory\(\[\]\)/);
});

test('materialized snapshots reconcile when missing from SQLite', () => {
  assert.match(database, /missing-cache-reconciliation/);
  assert.match(database, /async reconcileMissingMaterializedLeaderboards\(\{/);
  assert.match(database, /reason = 'full-load-cache-reconciliation'/);
  assert.doesNotMatch(lobby, /queueMaterializedLeaderboardRebuild|rebuildMaterializedLeaderboards/);
});

test('every restored save rebuilds standings from its restored source evidence', () => {
  for (const reason of [
    'compact-package-cache-reconciliation',
    'legacy-package-cache-reconciliation',
  ]) {
    const offset = importExport.indexOf(`reason: '${reason}'`);
    assert.ok(offset > 0, `expected ${reason}`);
    assert.match(importExport.slice(Math.max(0, offset - 80), offset + reason.length + 16), /force: true/);
  }
});

test('Dojo leaderboard uses bounded typed standings with canonical identity', () => {
  assert.match(dojo, /topSessions=\{standings\.top\}/);
  assert.match(dojoStandingsView, /<DojoTopSessions[\s\S]*?sessions=\{topSessions\}/);
  assert.match(dojoStandingsView, /<ProfileIdentity identity=\{session\.identity\}/);
  assert.match(dojoStandings, /getDojoStandings\(\{/);
  assert.match(dojoStandings, /topLimit:\s*10/);
  assert.doesNotMatch(dojo + dojoStandings, /getAllPlayers\(\)|DojoLeaderboardSnapshots/);
});
