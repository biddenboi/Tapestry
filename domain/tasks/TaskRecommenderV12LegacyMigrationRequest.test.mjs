import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadTaskRecommenderV12LegacyMigration,
  requestTaskRecommenderV12LegacyMigration,
  resetTaskRecommenderV12LegacyMigrationLoaderForTests,
} from './TaskRecommenderV12LegacyMigrationRequest.js';

test('loading the request boundary does not load conversion code', async () => {
  resetTaskRecommenderV12LegacyMigrationLoaderForTests();
  let imports = 0;
  const importer = async () => {
    imports += 1;
    return { migrateTaskRecommenderV11Offline: async () => ({ status: 'complete' }) };
  };
  assert.equal(imports, 0);
  const pending = loadTaskRecommenderV12LegacyMigration(importer);
  assert.equal(imports, 0);
  await pending;
  assert.equal(imports, 1);
});

test('old-format conversion loads once and only after an explicit request', async () => {
  resetTaskRecommenderV12LegacyMigrationLoaderForTests();
  let imports = 0;
  let migrations = 0;
  const importer = async () => {
    imports += 1;
    return {
      migrateTaskRecommenderV11Offline: async (databaseConnection, playerUUID) => {
        migrations += 1;
        return { status: 'complete', databaseConnection, playerUUID };
      },
    };
  };
  const databaseConnection = {};
  assert.equal(imports, 0);
  const first = await requestTaskRecommenderV12LegacyMigration(
    databaseConnection,
    'player-1',
    { importer },
  );
  const second = await requestTaskRecommenderV12LegacyMigration(
    databaseConnection,
    'player-1',
    { importer },
  );
  assert.equal(first.status, 'complete');
  assert.equal(second.status, 'complete');
  assert.equal(imports, 1);
  assert.equal(migrations, 2);
});

test('a failed explicit migration load can be retried', async () => {
  resetTaskRecommenderV12LegacyMigrationLoaderForTests();
  let imports = 0;
  const importer = async () => {
    imports += 1;
    if (imports === 1) throw new Error('temporary load failure');
    return { migrateTaskRecommenderV11Offline: async () => ({ status: 'complete' }) };
  };
  await assert.rejects(
    requestTaskRecommenderV12LegacyMigration({}, 'player-1', { importer }),
    /temporary load failure/,
  );
  const result = await requestTaskRecommenderV12LegacyMigration({}, 'player-1', { importer });
  assert.equal(result.status, 'complete');
  assert.equal(imports, 2);
});
