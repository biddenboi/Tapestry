import { STORES } from '@domain/constants.js';

export const TASK_RECOMMENDER_V12_SETTINGS_SCHEMA_VERSION = 2;
export const TASK_RECOMMENDER_V12_SETTINGS_PREFIX = 'task-recommender-v12-settings';

export const DEFAULT_TASK_RECOMMENDER_V12_SETTINGS = Object.freeze({
  schemaVersion: TASK_RECOMMENDER_V12_SETTINGS_SCHEMA_VERSION,
  continuousTraining: true,
  minimumResolvedDecisionsBeforeTraining: 8,
});

export function taskRecommenderV12SettingsId(playerUUID) {
  if (!playerUUID) throw new TypeError('v12 recommender settings require playerUUID');
  return `${TASK_RECOMMENDER_V12_SETTINGS_PREFIX}:${playerUUID}`;
}

export function isTaskRecommenderV12AutomaticTrainingEnabled(value = {}) {
  return value.continuousTraining !== false;
}

export function normalizeTaskRecommenderV12Settings(value = {}) {
  const configuredMinimum = value.minimumResolvedDecisionsBeforeTraining
    ?? value.minimumEventsBeforeTraining;
  return Object.freeze({
    schemaVersion: TASK_RECOMMENDER_V12_SETTINGS_SCHEMA_VERSION,
    continuousTraining: isTaskRecommenderV12AutomaticTrainingEnabled(value),
    minimumResolvedDecisionsBeforeTraining: Math.max(
      1,
      Math.min(500, Math.floor(Number(configuredMinimum) || 8)),
    ),
  });
}

export function isTaskRecommenderV12TrainingEvidenceSufficient(
  value = {},
  resolvedDecisionCount = 0,
) {
  const settings = normalizeTaskRecommenderV12Settings(value);
  return Math.max(0, Math.floor(Number(resolvedDecisionCount) || 0))
    >= settings.minimumResolvedDecisionsBeforeTraining;
}

export async function getTaskRecommenderV12Settings(databaseConnection, playerUUID) {
  if (!databaseConnection || !playerUUID) return DEFAULT_TASK_RECOMMENDER_V12_SETTINGS;
  const record = await databaseConnection.get(
    STORES.appSetting,
    taskRecommenderV12SettingsId(playerUUID),
  ).catch(() => null);
  return normalizeTaskRecommenderV12Settings(record?.value || {});
}

export async function saveTaskRecommenderV12Settings(databaseConnection, playerUUID, value = {}) {
  if (!databaseConnection || !playerUUID) throw new TypeError('v12 recommender settings require a profile');
  const normalized = normalizeTaskRecommenderV12Settings(value);
  const updatedAt = new Date().toISOString();
  await databaseConnection.add(STORES.appSetting, {
    UUID: taskRecommenderV12SettingsId(playerUUID),
    parent: String(playerUUID),
    value: normalized,
    updatedAt,
  });
  return normalized;
}
