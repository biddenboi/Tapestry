import { STORES } from '@domain/constants.js';

export const TASK_RECOMMENDER_V12_MIGRATION_SCHEMA_VERSION = 2;
export const TASK_RECOMMENDER_V12_MIGRATION_PREFIX = 'task-recommender-v12-migration';
export const TASK_RECOMMENDER_V12_REPAIR_PREFIX = 'task-recommender-v12-repair';

export class TaskRecommenderV12RepairRequiredError extends Error {
  constructor(state) {
    super('Task recommender data requires repair before recommendations can run.');
    this.name = 'TaskRecommenderV12RepairRequiredError';
    this.code = 'TASK_RECOMMENDER_V12_REPAIR_REQUIRED';
    this.repairState = state;
  }
}

export class TaskRecommenderV12MigrationPendingError extends Error {
  constructor(state) {
    super('Task recommender conversion is awaiting linked-folder recovery.');
    this.name = 'TaskRecommenderV12MigrationPendingError';
    this.code = 'TASK_RECOMMENDER_V12_MIGRATION_PENDING';
    this.migrationState = state;
  }
}

export function taskRecommenderV12MigrationId(playerUUID) {
  if (!playerUUID) throw new TypeError('A v12 migration state requires playerUUID');
  return `${TASK_RECOMMENDER_V12_MIGRATION_PREFIX}:${playerUUID}`;
}

export function taskRecommenderV12RepairId(playerUUID) {
  if (!playerUUID) throw new TypeError('A v12 repair state requires playerUUID');
  return `${TASK_RECOMMENDER_V12_REPAIR_PREFIX}:${playerUUID}`;
}

export async function getTaskRecommenderV12MigrationState(databaseConnection, playerUUID) {
  if (!databaseConnection || !playerUUID) return null;
  const record = await databaseConnection.get(
    STORES.appSetting,
    taskRecommenderV12MigrationId(playerUUID),
  ).catch(() => null);
  return record?.value || null;
}

/**
 * Runtime guard only. It never scans or converts old records. A conversion is
 * performed solely by the explicitly requested offline migration boundary.
 */
export async function assertTaskRecommenderV12RuntimeReady(databaseConnection, playerUUID) {
  const state = await getTaskRecommenderV12MigrationState(databaseConnection, playerUUID);
  if (state?.status === 'repair-required') {
    throw new TaskRecommenderV12RepairRequiredError(state);
  }
  if (state?.status === 'converted' || state?.cleanupPending || state?.recoveryRequired) {
    throw new TaskRecommenderV12MigrationPendingError(state);
  }
  return state;
}
