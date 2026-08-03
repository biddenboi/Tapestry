import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';
import InProcessSqliteClient from '../persistence/sqlite/testing/InProcessSqliteClient.js';
import SqliteRuntime from '../persistence/sqlite/SqliteRuntime.js';
import SqliteStorageAdapter from '../persistence/sqlite/SqliteStorageAdapter.js';

test('demo seed prepares the typed semantic world, Dojo, and encounter-memory paths', async (t) => {
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
    server: { middlewareMode: true },
    appType: 'custom',
  });
  const sqliteRuntime = new SqliteRuntime({ logger: { warn() {} } });
  const client = new InProcessSqliteClient({ runtime: sqliteRuntime });
  const sqliteStorageAdapter = new SqliteStorageAdapter({ client });
  const { default: DatabaseConnection } = await server.ssrLoadModule('/data/DatabaseConnection.js');
  const { buildTaverns } = await server.ssrLoadModule('/domain/social-world/TavernProjection.js');
  const { selectLobbyActivityPulses } = await server.ssrLoadModule('/domain/social-world/LobbyPresencePulses.js');
  const databaseConnection = new DatabaseConnection({ sqliteStorageAdapter });

  t.after(async () => {
    await sqliteStorageAdapter.close().catch(() => undefined);
    await server.close();
  });

  const seeded = await databaseConnection.loadDemoData();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seeded.typedDemo.status, 'seeded');
  assert.equal(seeded.typedDemo.castSize, 2);
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

  const scene = await databaseConnection.getSocialWorldScene({
    viewerId: 'demo-player',
    viewerIGT: seeded.typedDemo.viewerIGT,
  });
  assert.equal(scene.members.length, 5);
  assert.deepEqual(scene.locations.find((location) => location.id === 'dojo').occupants, [
    'demo-rival-mika',
    'demo-rival-rhea',
  ]);
  assert.equal(scene.members.every((member) => !('occupantKind' in member)), true);
  const taverns = buildTaverns(scene.members);
  assert.equal(taverns.some((tavern) => tavern.id === 'tavern:dojo' && tavern.count === 2), true);
  const pulses = selectLobbyActivityPulses(scene, { excludeProfileId: 'demo-player' });
  assert.equal(pulses.dojo.length, 2);
  assert.equal(pulses.match.length, 1);

  const roomFacts = await databaseConnection.getDojoRoomFacts({
    occupants: [
      { profileId: 'demo-rival-rhea', sessionId: 'demo-dojo-rhea' },
      { profileId: 'demo-rival-mika', sessionId: 'demo-dojo-mika' },
    ],
    viewerIGT: seeded.typedDemo.viewerIGT,
  });
  assert.deepEqual(roomFacts.map((fact) => fact.sessionPoints), [390, 450]);

  const standings = await databaseConnection.getDojoStandings({
    playerId: 'demo-player',
    currentSessionId: 'demo-dojo-session-player',
    topLimit: 10,
    aroundRadius: 2,
  });
  assert.equal(standings.current.points, 365);
  assert.equal(standings.top.length >= 4, true);
  assert.equal(standings.updating, false);

  const rheaCard = await databaseConnection.getSocialWorldProfileCard({
    viewerId: 'demo-player',
    profileId: 'demo-rival-rhea',
    viewerIGT: seeded.typedDemo.viewerIGT,
  });
  assert.equal(rheaCard.context.reason, 'no-shared-context');
  assert.deepEqual(rheaCard.context.items, []);
  assert.equal(rheaCard.thread, null);
  assert.deepEqual(rheaCard.next, []);
  assert.equal(rheaCard.new.count, 0);
});
