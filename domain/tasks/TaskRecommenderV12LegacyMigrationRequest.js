let migrationModulePromise = null;

export const TASK_RECOMMENDER_V12_LEGACY_MIGRATION_REQUEST_VERSION = 1;

export function loadTaskRecommenderV12LegacyMigration(
  importer = () => import('./TaskRecommenderV12Migration.js'),
) {
  if (!migrationModulePromise) {
    migrationModulePromise = Promise.resolve().then(importer).catch((error) => {
      migrationModulePromise = null;
      throw error;
    });
  }
  return migrationModulePromise;
}

export async function requestTaskRecommenderV12LegacyMigration(
  databaseConnection,
  playerUUID,
  { importer } = {},
) {
  if (!databaseConnection || !playerUUID) {
    throw new TypeError('An explicit legacy migration request requires a database connection and playerUUID');
  }
  const migration = await loadTaskRecommenderV12LegacyMigration(importer);
  return migration.migrateTaskRecommenderV11Offline(databaseConnection, playerUUID);
}

export function resetTaskRecommenderV12LegacyMigrationLoaderForTests() {
  migrationModulePromise = null;
}
