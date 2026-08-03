import { STORES } from '@domain/constants.js';
import { getTaskRecommenderProtocolEvents } from './TaskRecommenderLedger.js';
import {
  createTaskRecommenderV12Model,
  restoreTaskRecommenderV12Model,
  serializeTaskRecommenderV12Model,
} from './TaskRecommenderV12Model.js';
import {
  buildTaskRecommenderV12ResolvedExamples,
  trainTaskRecommenderV12Candidate,
} from './TaskRecommenderV12TrainingCore.js';
import {
  getTaskRecommenderV12Settings,
  isTaskRecommenderV12TrainingEvidenceSufficient,
} from './TaskRecommenderV12Settings.js';
import {
  ensureTaskRecommenderV12PolicyRegistry,
  registerTaskRecommenderV12PolicyCandidate,
} from './TaskRecommenderV12PolicyRegistry.js';

export const TASK_RECOMMENDER_V12_CHECKPOINT_PREFIX = 'task-recommender-v12-checkpoint';
export const TASK_RECOMMENDER_V12_TRAINING_DEFERRAL_PREFIX = 'task-recommender-v12-training-deferral';

const trainingQueues = new WeakMap();

function trainCandidateOffMainThread(model, targetModel, events, options = {}) {
  const trainingOptions = { ...options, targetModel };
  if (typeof Worker === 'undefined' || options.useWorker === false) {
    return Promise.resolve().then(() => trainTaskRecommenderV12Candidate(
      model,
      events,
      trainingOptions,
    ));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./TaskRecommenderV12TrainingWorker.js', import.meta.url),
      { type: 'module' },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Task recommender v12 training worker timed out'));
    }, Math.max(5_000, Math.min(60_000, Number(options.workerTimeoutMs) || 30_000)));
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      if (!event.data?.ok) {
        reject(new Error(event.data?.error || 'Task recommender v12 training worker failed'));
        return;
      }
      resolve({
        ...event.data.result,
        model: restoreTaskRecommenderV12Model(event.data.result.model),
      });
    };
    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error?.message || error)));
    };
    worker.postMessage({
      checkpoint: serializeTaskRecommenderV12Model(model),
      targetCheckpoint: serializeTaskRecommenderV12Model(targetModel),
      events,
      options,
    });
  });
}

export function taskRecommenderV12CheckpointId(playerUUID) {
  if (!playerUUID) throw new TypeError('A v12 checkpoint requires playerUUID');
  return `${TASK_RECOMMENDER_V12_CHECKPOINT_PREFIX}:${playerUUID}`;
}

export async function loadTaskRecommenderV12CandidateSnapshots(
  databaseConnection,
  examples = [],
) {
  const references = new Map();
  for (const example of examples) {
    for (const entry of example?.candidateManifest?.snapshots || []) {
      if (!entry?.snapshotUUID || !entry?.contentHash || !entry?.taskUUID) continue;
      references.set(String(entry.snapshotUUID), {
        ...entry,
        encoderVersion: example.candidateManifest.encoderVersion,
      });
    }
  }
  const snapshots = {};
  await Promise.all([...references.entries()].map(async ([snapshotUUID, reference]) => {
    const record = await databaseConnection.get(STORES.appSetting, snapshotUUID).catch(() => null);
    const value = record?.value;
    const snapshot = value?.snapshot;
    if (Number(value?.taskSnapshotRecordVersion) !== 1
      || Number(value?.encoderVersion) !== Number(reference.encoderVersion)
      || !snapshot
      || String(snapshot.UUID) !== String(reference.taskUUID)
      || String(snapshot.contentHash) !== String(reference.contentHash)
      || String(value.contentHash) !== String(reference.contentHash)) return;
    snapshots[snapshotUUID] = snapshot;
  }));
  return snapshots;
}

export async function getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID) {
  const record = await databaseConnection.get(
    STORES.appSetting,
    taskRecommenderV12CheckpointId(playerUUID),
  );
  if (!record?.value?.model) {
    const model = createTaskRecommenderV12Model({ seed: `profile:${playerUUID}` });
    return {
      model,
      targetModel: restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(model)),
      manifest: null,
      recoveredFromInvalidCheckpoint: false,
      recoveryReason: null,
      discardedModelVersion: null,
    };
  }
  try {
    const model = restoreTaskRecommenderV12Model(record.value.model);
    return {
      model,
      targetModel: restoreTaskRecommenderV12Model(record.value.targetModel || record.value.model),
      manifest: record.value.manifest || null,
      recoveredFromInvalidCheckpoint: false,
      recoveryReason: null,
      discardedModelVersion: null,
    };
  } catch (error) {
    const model = createTaskRecommenderV12Model({ seed: `profile:${playerUUID}` });
    const discardedModelVersion = Number.isFinite(Number(record.value.model?.modelVersion))
      ? Number(record.value.model.modelVersion)
      : null;
    return {
      model,
      targetModel: restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(model)),
      manifest: null,
      recoveredFromInvalidCheckpoint: true,
      recoveryReason: discardedModelVersion == null
        ? 'invalid-checkpoint'
        : 'incompatible-model-version',
      discardedModelVersion,
      recoveryError: error?.message || String(error),
    };
  }
}

export async function saveTaskRecommenderV12Checkpoint(
  databaseConnection,
  playerUUID,
  model,
  manifest = {},
  targetModel = model,
) {
  const normalized = restoreTaskRecommenderV12Model(serializeTaskRecommenderV12Model(model));
  const normalizedTarget = restoreTaskRecommenderV12Model(
    serializeTaskRecommenderV12Model(targetModel),
  );
  const updatedAt = new Date().toISOString();
  const record = {
    UUID: taskRecommenderV12CheckpointId(playerUUID),
    parent: String(playerUUID),
    value: {
      model: serializeTaskRecommenderV12Model(normalized),
      targetModel: serializeTaskRecommenderV12Model(normalizedTarget),
      manifest: {
        ...manifest,
        playerUUID: String(playerUUID),
        updatedAt,
      },
    },
    updatedAt,
  };
  await databaseConnection.add(STORES.appSetting, record);
  return record.value;
}

async function runTaskRecommenderV12Training(databaseConnection, playerUUID, options = {}) {
  const [checkpoint, events, settings] = await Promise.all([
    getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID),
    getTaskRecommenderProtocolEvents(databaseConnection, playerUUID),
    getTaskRecommenderV12Settings(databaseConnection, playerUUID),
  ]);
  const resolvedExamples = buildTaskRecommenderV12ResolvedExamples(events);
  const registry = await ensureTaskRecommenderV12PolicyRegistry(
    databaseConnection,
    playerUUID,
    checkpoint,
  );
  if (!isTaskRecommenderV12TrainingEvidenceSufficient(settings, resolvedExamples.length)) {
    return {
      model: checkpoint.model,
      promoted: false,
      deferred: true,
      deferralReason: 'insufficient-resolved-decisions',
      replaySize: resolvedExamples.length,
      resolvedExamples: resolvedExamples.length,
      trainedExamples: 0,
      trainedThroughSequence: checkpoint.manifest?.trainedThroughSequence || 0,
      metrics: {
        trainingGate: {
          eligible: false,
          resolvedDecisionCount: resolvedExamples.length,
          minimumResolvedDecisions: settings.minimumResolvedDecisionsBeforeTraining,
        },
      },
      checkpoint,
      registry,
    };
  }
  const energyState = options.energyState || {};
  if (energyState.deferTraining === true
    || energyState.lowPowerMode === true
    || energyState.thermalState === 'serious'
    || energyState.thermalState === 'critical') {
    const deferredAt = new Date().toISOString();
    await databaseConnection.add(STORES.appSetting, {
      UUID: `${TASK_RECOMMENDER_V12_TRAINING_DEFERRAL_PREFIX}:${playerUUID}:${deferredAt}`,
      parent: String(playerUUID),
      value: {
        schedulingSchemaVersion: 1,
        runtime: 'v12',
        reason: 'energy-sensitive-scheduling',
        lowPowerMode: energyState.lowPowerMode === true,
        thermalState: energyState.thermalState || null,
        occurredAt: deferredAt,
      },
      updatedAt: deferredAt,
    });
    return {
      model: checkpoint.model,
      promoted: false,
      deferred: true,
      deferralReason: 'energy-sensitive-scheduling',
      replaySize: resolvedExamples.length,
      resolvedExamples: resolvedExamples.length,
      trainedExamples: 0,
      trainedThroughSequence: checkpoint.manifest?.trainedThroughSequence || 0,
      metrics: {
        energyScheduling: {
          deferred: true,
          lowPowerMode: energyState.lowPowerMode === true,
          thermalState: energyState.thermalState || null,
          energySensitiveDeferrals: Math.max(
            1,
            (Number(checkpoint.manifest?.energyScheduling?.energySensitiveDeferrals) || 0) + 1,
          ),
          energyPolicyViolations: 0,
        },
      },
      checkpoint,
      registry,
    };
  }
  const candidateSnapshotsByUUID = await loadTaskRecommenderV12CandidateSnapshots(
    databaseConnection,
    resolvedExamples,
  );
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const trainingRunCount = Math.max(0, Number(checkpoint.manifest?.trainingRunCount) || 0) + 1;
  const targetSyncInterval = Math.max(1, Math.min(
    32,
    Math.floor(Number(options.targetSyncInterval) || 4),
  ));
  const result = await trainCandidateOffMainThread(checkpoint.model, checkpoint.targetModel, events, {
    maxEntries: Math.max(1, Math.min(5_000, Number(options.maxEntries) || 5_000)),
    recentFraction: options.recentFraction,
    maxSteps: Math.max(0, Math.min(512, Number(options.maxSteps) || 256)),
    learningRate: options.learningRate,
    promotionTolerance: options.promotionTolerance,
    seed: options.seed || `profile:${playerUUID}`,
    useWorker: options.useWorker,
    workerTimeoutMs: options.workerTimeoutMs,
    halfLifeMs: options.halfLifeMs,
    lambda: options.lambda,
    maxTraceSteps: options.maxTraceSteps,
    maxTraceElapsedMs: options.maxTraceElapsedMs,
    targetProbabilityByDecision: options.targetProbabilityByDecision,
    candidateSnapshotsByUUID,
    safetyPromotionTolerance: options.safetyPromotionTolerance,
    representationTrainingState: checkpoint.manifest?.representationTraining,
    representationPhaseThresholds: options.representationPhaseThresholds,
    representationTrustRadii: options.representationTrustRadii,
    valueRepresentationMaxSteps: options.valueRepresentationMaxSteps,
    valueLearningRate: options.valueLearningRate,
    safetyValueLossWeight: options.safetyValueLossWeight,
    maximumGradientNorm: options.maximumGradientNorm,
  });
  const completedAt = new Date().toISOString();
  const trainingWallTimeMs = Math.max(0, Date.now() - startedAtMs);
  const targetNetworkSynced = result.promoted && trainingRunCount % targetSyncInterval === 0;
  const nextTargetModel = targetNetworkSynced ? result.model : checkpoint.targetModel;
  const representationTrainingState = {
    ...result.representationTrainingState,
    targetCopy: {
      modelVersion: nextTargetModel.modelVersion,
      posteriorUpdateCount: Math.max(0, Number(nextTargetModel.posterior?.updateCount) || 0),
      safetyPosteriorUpdateCount: Math.max(
        0,
        Number(nextTargetModel.safetyPosterior?.updateCount) || 0,
      ),
      source: 'checkpoint-target-model',
      syncedThisRun: targetNetworkSynced,
    },
  };
  const saved = await saveTaskRecommenderV12Checkpoint(
    databaseConnection,
    playerUUID,
    result.model,
    {
      status: result.promoted ? 'promoted' : 'candidate-rejected',
      startedAt,
      completedAt,
      trainedThroughSequence: result.trainedThroughSequence,
      replaySize: result.replaySize,
      resolvedExamples: result.resolvedExamples,
      trainedExamples: result.trainedExamples,
      metrics: result.metrics,
      previousCheckpointRecovered: checkpoint.recoveredFromInvalidCheckpoint,
      checkpointRecoveryReason: checkpoint.recoveryReason,
      discardedModelVersion: checkpoint.discardedModelVersion,
      trainingRunCount,
      trainingWallTimeMs,
      energyScheduling: {
        deferred: false,
        lowPowerMode: energyState.lowPowerMode === true,
        thermalState: energyState.thermalState || null,
        energySensitiveDeferrals: Math.max(
          0,
          Number(checkpoint.manifest?.energyScheduling?.energySensitiveDeferrals) || 0,
        ),
        energyPolicyViolations: 0,
      },
      targetNetwork: {
        syncInterval: targetSyncInterval,
        syncedThisRun: targetNetworkSynced,
      },
      representationTraining: representationTrainingState,
    },
    nextTargetModel,
  );
  const candidatePolicyManifest = result.promoted
    ? await registerTaskRecommenderV12PolicyCandidate(
      databaseConnection,
      playerUUID,
      {
        model: result.model,
        targetModel: nextTargetModel,
        manifest: saved.manifest,
      },
      {
        parentCheckpoint: checkpoint,
        parentPolicyUUID: registry.pointer.championPolicyUUID,
        trainingEvidence: {
          ...saved.manifest,
          checkpointBytes: JSON.stringify({
            model: serializeTaskRecommenderV12Model(result.model),
            targetModel: serializeTaskRecommenderV12Model(nextTargetModel),
          }).length,
          trainingWallTimeMs,
          energySensitiveDeferrals: Math.max(
            0,
            Number(saved.manifest?.energyScheduling?.energySensitiveDeferrals) || 0,
          ),
          energyPolicyViolations: 0,
        },
      },
    )
    : null;
  return {
    ...result,
    representationTrainingState,
    checkpoint: saved,
    candidatePolicyManifest,
    registry,
  };
}

export function trainTaskRecommenderV12(databaseConnection, playerUUID, options = {}) {
  if (!databaseConnection || !playerUUID) return Promise.resolve(null);
  let byPlayer = trainingQueues.get(databaseConnection);
  if (!byPlayer) {
    byPlayer = new Map();
    trainingQueues.set(databaseConnection, byPlayer);
  }
  const key = String(playerUUID);
  const previous = byPlayer.get(key) || Promise.resolve();
  const run = previous.catch(() => undefined).then(() => (
    runTaskRecommenderV12Training(databaseConnection, key, options)
  ));
  let tracked;
  tracked = run.finally(() => {
    if (byPlayer.get(key) === tracked) byPlayer.delete(key);
  });
  byPlayer.set(key, tracked);
  return tracked;
}
