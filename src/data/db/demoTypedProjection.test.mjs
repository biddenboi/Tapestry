import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';
import InProcessSqliteClient from '../persistence/sqlite/testing/InProcessSqliteClient.js';
import SqliteRuntime from '../persistence/sqlite/SqliteRuntime.js';
import SqliteStorageAdapter from '../persistence/sqlite/SqliteStorageAdapter.js';

test('demo seed preserves task, profile, friendship and mobile projection paths', async (t) => {
  const alias = (path) => fileURLToPath(new URL(path, import.meta.url));
  const server = await createServer({
    root: alias('../..'),
    configFile: false,
    optimizeDeps: { noDiscovery: true, exclude: ['@sqlite.org/sqlite-wasm'] },
    resolve: {
      alias: {
        '@app': alias('../../app'),
        '@data': alias('../../data'),
        '@domain': alias('../../domain'),
        '@features': alias('../../features'),
        '@shared': alias('../../shared'),
      },
    },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  const sqliteRuntime = new SqliteRuntime({ logger: { warn() {} } });
  const client = new InProcessSqliteClient({ runtime: sqliteRuntime });
  const sqliteStorageAdapter = new SqliteStorageAdapter({ client });
  const { default: DatabaseConnection } = await server.ssrLoadModule('/data/DatabaseConnection.js');
  const { recoverPendingTaskCompletionProcessing } = await server.ssrLoadModule(
    '/features/tasks/domain/TaskCompletionProcessors.js',
  );
  const { recoverPendingAchievementEvents } = await server.ssrLoadModule(
    '/domain/achievements/AchievementProcessing.js',
  );
  const { queryMobileCompetition } = await server.ssrLoadModule(
    '/app/mobile/application/MobileCompetitionQueryService.js',
  );
  const {
    applyMobileReferenceRecords,
    collectMobileReferenceRecords,
  } = await server.ssrLoadModule('/data/sync/MobileReferenceSync.js');
  const databaseConnection = new DatabaseConnection({ sqliteStorageAdapter });

  t.after(async () => {
    await sqliteStorageAdapter.close().catch(() => undefined);
    await server.close();
  });

  const seeded = await databaseConnection.loadDemoData();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await recoverPendingTaskCompletionProcessing(databaseConnection);
  await recoverPendingAchievementEvents(databaseConnection);
  assert.equal(seeded.typedDemo.status, 'seeded');
  // Every seeded demo profile starts at zero Elo, Contribution, and Points.
  assert.equal('residentDemo' in seeded, false);
  const themeInventory = (await databaseConnection.getAll('inventory'))
    .filter((item) => item.parent === 'demo-player' && item.type === 'cosmetic_theme');
  assert.deepEqual(
    new Set(themeInventory.map((item) => item.itemId)),
    new Set([
      'minimalist_light',
      'kawaii',
      'dreamcore',
      'pixelated',
      'mature_beige',
      'old_windows',
      'obsidian',
      'gamification',
      'solarpunk',
      'frutiger_aero',
      'blueprint',
      'editorial_noir',
      'northstar',
      'atelier',
      'memory_palace',
      'commons',
    ]),
  );
  assert.equal(await sqliteStorageAdapter.query({
    sql: "SELECT COUNT(*) FROM achievement_evidence_receipts WHERE profile_id='demo-player'",
    result: 'value',
  }), 7);
  assert.equal(await sqliteStorageAdapter.query({
    sql: "SELECT COUNT(*) FROM achievement_legacy_awards WHERE profile_id='demo-player'",
    result: 'value',
  }), 4);
  assert.equal(await sqliteStorageAdapter.query({
    sql: 'SELECT COUNT(*) FROM theme_recipe_manifests',
    result: 'value',
  }), 17);

  // Reproduce an older clean-device bootstrap: canonical documents exist but
  // normalized profile/IGT/Match projections were never built. A reference
  // reconciliation must repair them before recovery processors run.
  const cloudRecords = await collectMobileReferenceRecords(databaseConnection, {
    bootstrap: true,
    includeActiveProfile: true,
  });
  const expectedDemoPlayer = await databaseConnection.get('players', 'demo-player');
  await sqliteStorageAdapter.executeAtomic({
    commandId: 'simulate-pre-projection-mobile-bootstrap',
    label: 'simulate-pre-projection-mobile-bootstrap',
    statements: [
      // This is test-only corruption setup. Production correctly prevents
      // deleting the last live profile while planning rows still reference it.
      { sql: 'DROP TRIGGER preserve_workspace_planning_before_player_delete', result: 'changes' },
      { sql: 'DELETE FROM players', result: 'changes' },
      { sql: 'DELETE FROM shadow_import_runs', result: 'changes' },
      // The simulated incomplete bootstrap never committed import commands.
      { sql: "DELETE FROM runtime_command_receipts WHERE command_label LIKE 'shadow-import-%'", result: 'changes' },
      {
        sql: "DELETE FROM sync_reference_meta WHERE key='mobile-reference-projections-v1'",
        result: 'changes',
      },
    ],
  });
  assert.equal(await sqliteStorageAdapter.query({
    sql: 'SELECT COUNT(*) FROM players',
    result: 'value',
  }), 0);

  const repaired = await applyMobileReferenceRecords(databaseConnection, cloudRecords, {
    forceActiveProfile: true,
  });
  assert.equal(repaired.projectionRepair.reconciled, true);
  assert.equal(repaired.projectionRepair.full, true);
  const repairedPlayer = await sqliteStorageAdapter.query({
    sql: "SELECT elo,in_game_time AS inGameTime FROM players WHERE id='demo-player'",
    result: 'one',
  });
  assert.deepEqual(repairedPlayer, { elo: 0, inGameTime: expectedDemoPlayer.inGameTime });
  assert.equal(Number(await sqliteStorageAdapter.query({
    sql: 'SELECT COUNT(*) FROM tasks',
    result: 'value',
  })) > 0, true);
  assert.equal(Number(await sqliteStorageAdapter.query({
    sql: 'SELECT COUNT(*) FROM matches',
    result: 'value',
  })) > 0, true);
  await databaseConnection.reconcileMissingMaterializedLeaderboards({
    reason: 'mobile-projection-repair-test',
    force: true,
  });
  const mobileCompetition = await queryMobileCompetition(databaseConnection, {
    playerUUID: 'demo-player',
    viewerIGT: seeded.typedDemo.viewerIGT,
  });
  assert.equal(mobileCompetition.metrics.elo, repairedPlayer.elo);
  assert.deepEqual(mobileCompetition.metrics, { elo: 0, points: 0, contribution: 0 });
  assert.equal(mobileCompetition.eloHistory.length >= 2, true);
  await recoverPendingTaskCompletionProcessing(databaseConnection);
  await recoverPendingAchievementEvents(databaseConnection);
});
