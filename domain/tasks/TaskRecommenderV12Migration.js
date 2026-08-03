import { STORES } from '@domain/constants.js';
import {
  prepareTaskRecommenderProtocolEvents,
} from './TaskRecommenderLedger.js';
import {
  createTaskRecommenderProtocolEvent,
  isTaskRecommenderProtocolEvent,
} from './TaskRecommenderProtocol.js';
import {
  getTaskRecommenderV12Checkpoint,
  taskRecommenderV12CheckpointId,
} from './TaskRecommenderV12Training.js';
import { serializeTaskRecommenderV12Model } from './TaskRecommenderV12Model.js';
import { taskRecommenderV12SettingsId } from './TaskRecommenderV12Settings.js';

import {
  TASK_RECOMMENDER_V12_MIGRATION_SCHEMA_VERSION,
  assertTaskRecommenderV12RuntimeReady,
  getTaskRecommenderV12MigrationState,
  taskRecommenderV12MigrationId,
  taskRecommenderV12RepairId,
} from './TaskRecommenderV12RuntimeState.js';
import {
  reportTaskRecommenderV12Migration,
  taskRecommenderV12ReportTimer,
} from './TaskRecommenderV12DevelopmentReporter.js';

const TASK_RECOMMENDER_V11_SETTINGS_ID = 'taskRecommenderSettings';
const TASK_RECOMMENDER_V11_WEIGHTS_PREFIX = 'taskRecommenderWeights';

async function loadOfflineReader() {
  return import('./TaskRecommenderV11OfflineReader.js');
}

export {
  TASK_RECOMMENDER_V12_MIGRATION_SCHEMA_VERSION,
  getTaskRecommenderV12MigrationState,
  taskRecommenderV12MigrationId,
  taskRecommenderV12RepairId,
};

const nowISO = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

async function readKnownV11Settings(databaseConnection, playerUUID) {
  const ids = [
    TASK_RECOMMENDER_V11_SETTINGS_ID,
    TASK_RECOMMENDER_V11_WEIGHTS_PREFIX,
    `${TASK_RECOMMENDER_V11_WEIGHTS_PREFIX}:${playerUUID}`,
  ];
  const records = await Promise.all(ids.map((UUID) => (
    databaseConnection.get(STORES.appSetting, UUID).catch(() => null)
  )));
  return records.filter(Boolean);
}

async function readMigrationInputs(databaseConnection, playerUUID) {
  const [recommendationEvents, appSettings] = await Promise.all([
    databaseConnection.getPlayerStore(STORES.recommenderEvent, playerUUID).catch(() => []),
    readKnownV11Settings(databaseConnection, playerUUID),
  ]);
  return { recommendationEvents, appSettings };
}

async function persistAtomic(databaseConnection, mutation) {
  if (typeof databaseConnection.commitAtomicMutation === 'function') {
    return databaseConnection.commitAtomicMutation(mutation);
  }
  for (const entry of mutation.puts || []) await databaseConnection.add(entry.store, entry.record);
  if (typeof databaseConnection.delete === 'function') {
    for (const entry of mutation.deletes || []) await databaseConnection.delete(entry.store, entry.UUID);
  }
  return { changed: true, label: mutation.label, operationCount: (mutation.puts?.length || 0) + (mutation.deletes?.length || 0) };
}

function checkpointRecord(playerUUID, checkpoint, updatedAt) {
  return {
    UUID: taskRecommenderV12CheckpointId(playerUUID),
    parent: String(playerUUID),
    value: {
      model: serializeTaskRecommenderV12Model(checkpoint.model),
      targetModel: serializeTaskRecommenderV12Model(checkpoint.targetModel),
      manifest: {
        ...(checkpoint.manifest || {}),
        playerUUID: String(playerUUID),
        status: checkpoint.manifest?.status || 'cold-start',
        migrationCreatedAt: updatedAt,
        updatedAt,
      },
    },
    updatedAt,
  };
}

function migrationRecord(playerUUID, value, updatedAt = nowISO()) {
  return {
    UUID: taskRecommenderV12MigrationId(playerUUID),
    parent: String(playerUUID),
    value: {
      migrationSchemaVersion: TASK_RECOMMENDER_V12_MIGRATION_SCHEMA_VERSION,
      playerUUID: String(playerUUID),
      ...clone(value),
    },
    updatedAt,
  };
}

function repairRecord(playerUUID, issues, sourceSummary, updatedAt = nowISO()) {
  return {
    UUID: taskRecommenderV12RepairId(playerUUID),
    parent: String(playerUUID),
    value: {
      migrationSchemaVersion: TASK_RECOMMENDER_V12_MIGRATION_SCHEMA_VERSION,
      status: 'repair-required',
      playerUUID: String(playerUUID),
      detectedAt: updatedAt,
      issues: clone(issues),
      sourceSummary: clone(sourceSummary),
      runtimeFallbackAllowed: false,
      legacyArtifactsRetained: true,
    },
    updatedAt,
  };
}

async function writeRepairState(databaseConnection, playerUUID, reader) {
  const updatedAt = nowISO();
  const repair = repairRecord(playerUUID, reader.issues, {
    settings: reader.settings.length,
    legacyEvents: reader.legacyEvents.length,
  }, updatedAt);
  const migration = migrationRecord(playerUUID, {
    status: 'repair-required',
    repairStateUUID: repair.UUID,
    issues: reader.issues,
    runtimeFallbackAllowed: false,
    legacyArtifactsRetained: true,
  }, updatedAt);
  await persistAtomic(databaseConnection, {
    label: 'task-recommender-v12-migration-repair-state',
    puts: [
      { store: STORES.appSetting, record: repair },
      { store: STORES.appSetting, record: migration },
    ],
  });
  return migration.value;
}

async function flushConvertedGeneration(databaseConnection) {
  if (typeof databaseConnection.flushLinkedFolderWrite !== 'function') {
    return { durable: true, reason: 'no-linked-folder-flush-api' };
  }
  try {
    const result = await databaseConnection.flushLinkedFolderWrite();
    if (result?.reason === 'pending-retry' || result?.reason === 'permission-required') {
      return { durable: false, reason: result.reason };
    }
    return { durable: true, reason: result?.reason || 'flushed' };
  } catch (error) {
    return { durable: false, reason: error?.message || String(error) };
  }
}

async function writeConvertedPhase(databaseConnection, playerUUID, reader, allRows) {
  const updatedAt = nowISO();
  const existingProtocolRows = (allRows || []).filter(isTaskRecommenderProtocolEvent);
  const prepared = prepareTaskRecommenderProtocolEvents(reader.protocolInputs, existingProtocolRows);
  const existingIds = new Set(existingProtocolRows.map((event) => String(event.UUID)));
  const additions = prepared.filter((event) => !existingIds.has(String(event.UUID)));
  const existingCheckpoint = await databaseConnection.get(
    STORES.appSetting,
    taskRecommenderV12CheckpointId(playerUUID),
  ).catch(() => null);
  const checkpoint = existingCheckpoint ? null : await getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID);
  const converted = migrationRecord(playerUUID, {
    status: 'converted',
    convertedAt: updatedAt,
    protocolEventsWritten: additions.length,
    legacyRecommendationEvents: reader.legacyEvents.length,
    legacySettingsRecords: reader.settings.length,
    outcomesRetained: prepared.filter((event) => [
      'recommendation_accepted',
      'recommendation_skipped',
      'task_session_finished',
      'task_recorded_complete',
    ].includes(event.type)).length,
    cleanupPending: true,
    runtimeFallbackAllowed: false,
  }, updatedAt);
  const settingsRecord = {
    UUID: taskRecommenderV12SettingsId(playerUUID),
    parent: String(playerUUID),
    value: reader.v12Settings,
    updatedAt,
  };
  const puts = [
    ...additions.map((record) => ({ store: STORES.recommenderEvent, record })),
    ...(checkpoint ? [{ store: STORES.appSetting, record: checkpointRecord(playerUUID, checkpoint, updatedAt) }] : []),
    { store: STORES.appSetting, record: settingsRecord },
    { store: STORES.appSetting, record: converted },
  ];
  await persistAtomic(databaseConnection, {
    label: 'task-recommender-v12-migration-convert',
    puts,
  });
  const durability = await flushConvertedGeneration(databaseConnection);
  return { state: converted.value, durability };
}

async function writeCleanupPhase(databaseConnection, playerUUID, reader, convertedState) {
  const updatedAt = nowISO();
  const completed = migrationRecord(playerUUID, {
    ...convertedState,
    status: 'complete',
    completedAt: updatedAt,
    cleanupPending: false,
    discardedLegacyRecommendationEvents: reader.discard.recommendationEventUUIDs.length,
    discardedLegacySettingsRecords: reader.discard.appSettingUUIDs.length,
    runtimeFallbackAllowed: false,
  }, updatedAt);
  await persistAtomic(databaseConnection, {
    label: 'task-recommender-v12-migration-cleanup',
    puts: [{ store: STORES.appSetting, record: completed }],
    deletes: [
      ...reader.discard.recommendationEventUUIDs.map((UUID) => ({ store: STORES.recommenderEvent, UUID })),
      ...reader.discard.appSettingUUIDs.map((UUID) => ({ store: STORES.appSetting, UUID })),
    ],
  });
  return completed.value;
}

export async function migrateTaskRecommenderV11Offline(databaseConnection, playerUUID) {
  if (!databaseConnection || !playerUUID) return null;
  const owner = String(playerUUID);
  const prior = await getTaskRecommenderV12MigrationState(databaseConnection, owner);
  if (prior?.status === 'complete') return prior;
  if (prior?.status === 'repair-required') return prior;

  const startedAt = taskRecommenderV12ReportTimer();
  const inputs = await readMigrationInputs(databaseConnection, owner);
  const { readTaskRecommenderV11Records } = await loadOfflineReader();
  const reader = readTaskRecommenderV11Records({ playerUUID: owner, ...inputs });
  const report = (state) => {
    reportTaskRecommenderV12Migration({
      playerUUID: owner,
      startedAt,
      sourcePayload: inputs,
      convertedPayload: reader.protocolInputs,
      sourceRecordCount: reader.settings.length + reader.legacyEvents.length,
      convertedRecordCount: reader.protocolInputs.length,
      status: state?.status || 'unknown',
    });
    return state;
  };
  if (reader.issues.length) return report(await writeRepairState(databaseConnection, owner, reader));

  if (!reader.hasLegacyArtifacts) {
    const completed = migrationRecord(owner, {
      status: 'complete',
      completedAt: nowISO(),
      protocolEventsWritten: 0,
      legacyRecommendationEvents: 0,
      legacySettingsRecords: 0,
      outcomesRetained: 0,
      cleanupPending: false,
      runtimeFallbackAllowed: false,
    });
    await persistAtomic(databaseConnection, {
      label: 'task-recommender-v12-migration-no-legacy-data',
      puts: [{ store: STORES.appSetting, record: completed }],
    });
    return report(completed.value);
  }

  let convertedState = prior;
  if (prior?.status !== 'converted') {
    const converted = await writeConvertedPhase(
      databaseConnection,
      owner,
      reader,
      inputs.recommendationEvents,
    );
    convertedState = converted.state;
    if (!converted.durability.durable) {
      return report({
        ...convertedState,
        recoveryRequired: true,
        recoveryReason: converted.durability.reason,
      });
    }
  } else {
    const durability = await flushConvertedGeneration(databaseConnection);
    if (!durability.durable) {
      return report({
        ...convertedState,
        recoveryRequired: true,
        recoveryReason: durability.reason,
      });
    }
  }

  return report(await writeCleanupPhase(databaseConnection, owner, reader, convertedState));
}

export async function ensureTaskRecommenderV12Cutover(databaseConnection, playerUUID) {
  return assertTaskRecommenderV12RuntimeReady(databaseConnection, playerUUID);
}

export async function recoverTaskRecommenderV12Migration(databaseConnection, playerUUID) {
  return migrateTaskRecommenderV11Offline(databaseConnection, playerUUID);
}

export function createTaskRecommenderV12MigrationFixtureEvents(inputs = []) {
  return inputs.map((input, index) => createTaskRecommenderProtocolEvent({
    ...input,
    sequence: input.sequence || index + 1,
  }));
}
