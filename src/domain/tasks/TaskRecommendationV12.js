import { STORES } from '@domain/constants.js';
import { getTaskRecommenderProtocolEvents } from './TaskRecommenderLedger.js';
import {
  TASK_RECOMMENDER_V12_TRAINING_DEFERRAL_PREFIX,
  getTaskRecommenderV12Checkpoint,
  taskRecommenderV12CheckpointId,
  trainTaskRecommenderV12,
} from './TaskRecommenderV12Training.js';
import { serializeTaskRecommenderV12Model } from './TaskRecommenderV12Model.js';
import { evaluateTaskRecommenderV12 } from './TaskRecommenderV12Serving.js';
import { TASK_RECOMMENDER_V12_TASK_SNAPSHOT_PREFIX } from './TaskRecommenderV12CandidateEvidence.js';
import {
  TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
  buildTaskRecommendationV12ImportContract,
  createTaskRecommendationV12BundleContract,
  createTaskRecommendationV12CheckpointContract,
  createTaskRecommendationV12InferenceRequest,
  createTaskRecommendationV12InferenceResult,
  createTaskRecommendationV12TrainingContract,
  createTaskRecommendationV12TrainingRequest,
  createTaskRecommendationV12TrainingResult,
  parseTaskRecommendationV12CheckpointContract,
} from './TaskRecommendationV12Contracts.js';
import {
  reportTaskRecommenderV12Inference,
  reportTaskRecommenderV12Persistence,
} from './TaskRecommenderV12DevelopmentReporter.js';
import {
  TASK_RECOMMENDER_V12_POLICY_MANIFEST_PREFIX,
  ensureTaskRecommenderV12PolicyRegistry,
  promoteTaskRecommenderV12Champion,
  registerTaskRecommenderV12PolicyCandidate,
  rollbackTaskRecommenderV12Champion,
  saveTaskRecommenderV12Experiment,
} from './TaskRecommenderV12PolicyRegistry.js';
import {
  buildTaskRecommenderV12EvidenceReport,
  evaluateTaskRecommenderV12Promotion,
} from './TaskRecommenderV12Evidence.js';

export const TASK_RECOMMENDATION_V12_FACADE_VERSION = '12.3';
export const TASK_RECOMMENDATION_V12_IMPORT_RECEIPT_PREFIX = 'task-recommender-v12-import';
export const TASK_RECOMMENDATION_V12_RECOVERY_PREFIX = 'task-recommender-v12-import-recovery';

const privateInferenceState = new WeakMap();

export function getTaskRecommendationV12PrivateInferenceState(result) {
  return privateInferenceState.get(result) || null;
}

function stableSerialize(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

export function taskRecommendationV12Fingerprint(value) {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

function checkpointContract(playerUUID, checkpoint, exportedAt = new Date().toISOString()) {
  return createTaskRecommendationV12CheckpointContract({
    playerUUID,
    model: checkpoint.model,
    targetModel: checkpoint.targetModel,
    manifest: checkpoint.manifest,
    exportedAt,
  });
}

function checkpointRecord(playerUUID, contract) {
  const updatedAt = new Date().toISOString();
  return {
    UUID: taskRecommenderV12CheckpointId(playerUUID),
    parent: String(playerUUID),
    value: {
      model: serializeTaskRecommenderV12Model(contract.checkpoint.model),
      targetModel: serializeTaskRecommenderV12Model(contract.checkpoint.targetModel),
      manifest: {
        ...(contract.checkpoint.manifest || {}),
        playerUUID: String(playerUUID),
        importedAt: updatedAt,
        updatedAt,
      },
    },
    updatedAt,
  };
}

async function commitAtomic(databaseConnection, mutation) {
  if (typeof databaseConnection.commitAtomicMutation === 'function') {
    return databaseConnection.commitAtomicMutation(mutation);
  }
  for (const entry of mutation.puts || []) await databaseConnection.add(entry.store, entry.record);
  if (typeof databaseConnection.delete === 'function') {
    for (const entry of mutation.deletes || []) await databaseConnection.delete(entry.store, entry.UUID);
  }
  return { changed: true, operationCount: mutation.puts?.length || 0 };
}

function completedImportReceipt(value = {}) {
  return Object.freeze({
    ...value,
    status: 'complete',
    durable: true,
  });
}

export async function readTaskRecommendationV12Checkpoint(databaseConnection, playerUUID) {
  const checkpoint = await getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID);
  return checkpointContract(String(playerUUID), checkpoint);
}

export async function trainTaskRecommendationV12(databaseConnection, input = {}) {
  const request = createTaskRecommendationV12TrainingRequest(input);
  const result = await trainTaskRecommenderV12(
    databaseConnection,
    request.playerUUID,
    request.options,
  );
  const checkpoint = await getTaskRecommenderV12Checkpoint(
    databaseConnection,
    request.playerUUID,
  );
  return createTaskRecommendationV12TrainingResult({
    request,
    status: result?.deferred
      ? `deferred-${result.deferralReason || 'scheduling'}`
      : result?.candidatePolicyManifest ? 'candidate-ready'
        : result?.checkpoint ? 'completed' : 'no-op',
    checkpoint: checkpointContract(request.playerUUID, checkpoint),
    metrics: result?.metrics || null,
    trainedThroughSequence: result?.trainedThroughSequence ?? null,
  });
}

export async function createTaskRecommendationV12Ablation(databaseConnection, input = {}) {
  const playerUUID = String(input.playerUUID || '');
  if (!playerUUID) throw new TypeError('playerUUID is required');
  const checkpoint = await getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID);
  const registry = await ensureTaskRecommenderV12PolicyRegistry(
    databaseConnection,
    playerUUID,
    checkpoint,
  );
  return registerTaskRecommenderV12PolicyCandidate(databaseConnection, playerUUID, checkpoint, {
    role: 'ablation',
    policyUUID: input.policyUUID,
    policyOptions: input.policyOptions || {},
    parentPolicyUUID: registry.pointer.championPolicyUUID,
    trainingEvidence: checkpoint.manifest,
  });
}

export async function configureTaskRecommendationV12Experiment(databaseConnection, input = {}) {
  const playerUUID = String(input.playerUUID || '');
  if (!playerUUID) throw new TypeError('playerUUID is required');
  const checkpoint = await getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID);
  await ensureTaskRecommenderV12PolicyRegistry(databaseConnection, playerUUID, checkpoint);
  return saveTaskRecommenderV12Experiment(databaseConnection, input);
}

export async function reportTaskRecommendationV12Evidence(
  databaseConnection,
  playerUUID,
  options = {},
) {
  const owner = String(playerUUID || '');
  if (!owner) throw new TypeError('playerUUID is required');
  const [events, appSettings] = await Promise.all([
    getTaskRecommenderProtocolEvents(databaseConnection, owner),
    databaseConnection.getPlayerStore(STORES.appSetting, owner).catch(() => []),
  ]);
  const manifestPrefix = `${TASK_RECOMMENDER_V12_POLICY_MANIFEST_PREFIX}:${owner}:`;
  const trainingEvidenceByPolicy = Object.fromEntries(appSettings
    .filter((record) => String(record.UUID || '').startsWith(manifestPrefix))
    .filter((record) => record.value?.runtime === 'v12' && record.value?.policyUUID)
    .map((record) => [record.value.policyUUID, {
      ...(record.value.trainingEvidence || {}),
      checkpointBytes: record.value.checkpointBytes,
      trainingWallTimeMs: record.value.trainingEvidence?.trainingWallTimeMs,
      energySensitiveDeferrals:
        record.value.trainingEvidence?.energySensitiveDeferrals
        ?? record.value.trainingEvidence?.energyScheduling?.energySensitiveDeferrals,
      energyPolicyViolations:
        record.value.trainingEvidence?.energyPolicyViolations
        ?? record.value.trainingEvidence?.energyScheduling?.energyPolicyViolations,
    }]));
  const energySensitiveDeferrals = appSettings.filter((record) => (
    String(record.UUID || '').startsWith(
      `${TASK_RECOMMENDER_V12_TRAINING_DEFERRAL_PREFIX}:${owner}:`,
    )
    && record.value?.runtime === 'v12'
    && record.value?.reason === 'energy-sensitive-scheduling'
  )).length;
  return buildTaskRecommenderV12EvidenceReport(events, {
    ...options,
    trainingEvidenceByPolicy,
    energySensitiveDeferrals,
  });
}

export async function promoteTaskRecommendationV12Candidate(databaseConnection, input = {}) {
  const playerUUID = String(input.playerUUID || '');
  if (!playerUUID || !input.candidatePolicyUUID || !input.championPolicyUUID) {
    throw new TypeError('playerUUID, candidatePolicyUUID, and championPolicyUUID are required');
  }
  const report = input.report || await reportTaskRecommendationV12Evidence(
    databaseConnection,
    playerUUID,
    input.reportOptions,
  );
  const decision = evaluateTaskRecommenderV12Promotion(
    report,
    input.candidatePolicyUUID,
    input.championPolicyUUID,
    input.gates,
  );
  if (!decision.eligible) return Object.freeze({ promoted: false, report, decision });
  const promotion = await promoteTaskRecommenderV12Champion(
    databaseConnection,
    playerUUID,
    input.candidatePolicyUUID,
    decision,
  );
  return Object.freeze({ promoted: true, report, decision, promotion });
}

export async function rollbackTaskRecommendationV12Champion(
  databaseConnection,
  playerUUID,
  options = {},
) {
  return rollbackTaskRecommenderV12Champion(databaseConnection, playerUUID, options);
}

export async function inferTaskRecommendationV12(databaseConnection, input = {}) {
  const request = createTaskRecommendationV12InferenceRequest(input);
  const evaluation = await evaluateTaskRecommenderV12({
    databaseConnection,
    currentPlayer: { UUID: request.playerUUID },
    todos: request.tasks,
    source: request.source,
    now: new Date(request.now),
    decisionSeed: request.decisionSeed,
    constraints: request.constraints,
  });
  if (!evaluation) {
    return createTaskRecommendationV12InferenceResult({
      request,
      selected: null,
      mode: 'empty',
      behaviorProbability: null,
    });
  }
  reportTaskRecommenderV12Inference({
    playerUUID: request.playerUUID,
    source: request.source,
    device: evaluation.device,
  });
  const result = createTaskRecommendationV12InferenceResult({
    request,
    selected: evaluation.recommendation,
    mode: 'production-v12',
    behaviorProbability: evaluation.policyDecision?.selected?.jointBehaviorProbability ?? null,
    diagnostics: {
      servingSchemaVersion: evaluation.servingSchemaVersion,
      policyVersion: evaluation.policyDecision?.policyVersion || null,
      policyUUID: evaluation.policyAssignment?.policyUUID || null,
    },
  });
  privateInferenceState.set(result, Object.freeze({
    policyDecision: evaluation.policyDecision || null,
    candidateEvidence: evaluation.candidateEvidence || null,
    device: evaluation.device || null,
    policyAssignment: evaluation.policyAssignment || null,
  }));
  return result;
}

export async function exportTaskRecommendationV12Bundle(databaseConnection, playerUUID) {
  const owner = String(playerUUID || '');
  if (!owner) throw new TypeError('playerUUID is required');
  const exportedAt = new Date().toISOString();
  const [checkpoint, protocolEvents, appSettings] = await Promise.all([
    getTaskRecommenderV12Checkpoint(databaseConnection, owner),
    getTaskRecommenderProtocolEvents(databaseConnection, owner),
    databaseConnection.getPlayerStore(STORES.appSetting, owner).catch(() => []),
  ]);
  const candidateSnapshots = appSettings.filter((record) => (
    String(record.UUID || '').startsWith(`${TASK_RECOMMENDER_V12_TASK_SNAPSHOT_PREFIX}:${owner}:`)
  ));
  const evidencePayload = {
    playerUUID: owner,
    checkpointId: taskRecommenderV12CheckpointId(owner),
    protocolEventIds: protocolEvents.map((event) => event.UUID),
    candidateSnapshotIds: candidateSnapshots.map((record) => record.UUID),
  };
  const bundle = createTaskRecommendationV12BundleContract({
    playerUUID: owner,
    exportedAt,
    checkpoint: checkpointContract(owner, checkpoint, exportedAt),
    trainingData: createTaskRecommendationV12TrainingContract({
      playerUUID: owner,
      events: protocolEvents,
      exportedAt,
      cursor: {
        throughSequence: protocolEvents.reduce(
          (maximum, event) => Math.max(maximum, Number(event.sequence) || 0),
          0,
        ),
      },
    }),
    candidateSnapshots,
    recoveryEvidence: {
      evidenceVersion: 1,
      activeRuntime: 'v12',
      generatedAt: exportedAt,
      fingerprint: taskRecommendationV12Fingerprint(evidencePayload),
      ...evidencePayload,
    },
  });
  reportTaskRecommenderV12Persistence({
    operation: 'export-bundle',
    playerUUID: owner,
    payload: bundle,
    recordCount: protocolEvents.length + candidateSnapshots.length + 1,
  });
  return bundle;
}

export function inspectTaskRecommendationV12Import(payload, options = {}) {
  return buildTaskRecommendationV12ImportContract(payload, options);
}

export function planTaskRecommendationV12Import(payload, options = {}) {
  const contract = buildTaskRecommendationV12ImportContract(payload, options);
  const target = contract.targetPlayerUUID;
  if (target !== contract.sourcePlayerUUID) {
    throw new TypeError('v12 bundle imports must target the source profile');
  }
  return Object.freeze({
    ...contract,
    cutoverTransaction: Object.freeze({
      type: 'atomic-batch',
      label: 'task-recommender-v12-import',
      operations: Object.freeze([
        Object.freeze({
          type: 'put',
          store: STORES.appSetting,
          UUID: taskRecommenderV12CheckpointId(target),
          source: 'checkpoint',
        }),
        ...contract.trainingData.events.map((event) => Object.freeze({
          type: 'put',
          store: STORES.recommenderEvent,
          UUID: event.UUID,
          source: 'trainingData.events',
        })),
        ...contract.candidateSnapshots.map((record) => Object.freeze({
          type: 'put',
          store: STORES.appSetting,
          UUID: record.UUID,
          source: 'candidateSnapshots',
        })),
      ]),
    }),
  });
}

export async function resumeTaskRecommendationV12Import(
  databaseConnection,
  playerUUID,
  receiptUUID,
) {
  if (!databaseConnection || !playerUUID || !receiptUUID) {
    throw new TypeError('A v12 import recovery requires databaseConnection, playerUUID, and receiptUUID');
  }
  const receipt = await databaseConnection.get(STORES.appSetting, receiptUUID).catch(() => null);
  if (!receipt?.value || String(receipt.parent || '') !== String(playerUUID)) {
    throw new TypeError('Unknown v12 import receipt');
  }
  return completedImportReceipt(receipt.value);
}

export async function importTaskRecommendationV12Bundle(
  databaseConnection,
  playerUUID,
  payload,
) {
  const plan = planTaskRecommendationV12Import(payload, { targetPlayerUUID: playerUUID });
  const fingerprint = taskRecommendationV12Fingerprint({
    checkpoint: plan.checkpoint,
    trainingData: plan.trainingData,
    candidateSnapshots: plan.candidateSnapshots,
  });
  const receiptUUID = `${TASK_RECOMMENDATION_V12_IMPORT_RECEIPT_PREFIX}:${playerUUID}:${fingerprint}`;
  const existingReceipt = await databaseConnection.get(STORES.appSetting, receiptUUID).catch(() => null);
  if (existingReceipt?.value) {
    return resumeTaskRecommendationV12Import(databaseConnection, playerUUID, receiptUUID);
  }

  const [previousCheckpoint, currentEvents, previousCandidateSnapshots] = await Promise.all([
    databaseConnection.get(STORES.appSetting, taskRecommenderV12CheckpointId(playerUUID)).catch(() => null),
    getTaskRecommenderProtocolEvents(databaseConnection, playerUUID),
    Promise.all(plan.candidateSnapshots.map((record) => (
      databaseConnection.get(STORES.appSetting, record.UUID).catch(() => null)
    ))),
  ]);
  const importedAt = new Date().toISOString();
  const recoveryUUID = `${TASK_RECOMMENDATION_V12_RECOVERY_PREFIX}:${playerUUID}:${fingerprint}`;
  const importedEventUUIDs = plan.trainingData.events.map((event) => String(event.UUID));
  const recoveryRecord = {
    UUID: recoveryUUID,
    parent: String(playerUUID),
    value: {
      recoverySchemaVersion: 2,
      status: 'available',
      createdAt: importedAt,
      previousCheckpoint,
      previousProtocolEvents: currentEvents,
      importedProtocolEventUUIDs: importedEventUUIDs,
      importedCandidateSnapshotUUIDs: plan.candidateSnapshots.map((record) => String(record.UUID)),
      previousCandidateSnapshots: previousCandidateSnapshots.filter(Boolean),
      importedFingerprint: fingerprint,
      boundary: 'v12-only',
    },
    updatedAt: importedAt,
  };
  const receipt = {
    UUID: receiptUUID,
    parent: String(playerUUID),
    value: {
      importSchemaVersion: 2,
      receiptUUID,
      status: 'complete',
      importedAt,
      fingerprint,
      checkpointUUID: taskRecommenderV12CheckpointId(playerUUID),
      protocolEventsImported: importedEventUUIDs.length,
      candidateSnapshotsImported: plan.candidateSnapshots.length,
      importedProtocolEventUUIDs: importedEventUUIDs,
      recoveryUUID,
      durable: true,
      runtimeFallbackAllowed: false,
    },
    updatedAt: importedAt,
  };
  await commitAtomic(databaseConnection, {
    label: 'task-recommender-v12-import',
    puts: [
      { store: STORES.appSetting, record: recoveryRecord },
      { store: STORES.appSetting, record: checkpointRecord(playerUUID, plan.checkpoint) },
      ...plan.candidateSnapshots.map((record) => ({ store: STORES.appSetting, record })),
      ...plan.trainingData.events.map((record) => ({ store: STORES.recommenderEvent, record })),
      { store: STORES.appSetting, record: receipt },
    ],
  });
  reportTaskRecommenderV12Persistence({
    operation: 'import-bundle',
    playerUUID,
    payload: plan,
    recordCount: plan.trainingData.events.length + plan.candidateSnapshots.length + 3,
  });
  return completedImportReceipt(receipt.value);
}

export async function rollbackTaskRecommendationV12Import(
  databaseConnection,
  playerUUID,
  recoveryUUID,
) {
  if (!databaseConnection || !playerUUID || !recoveryUUID) {
    throw new TypeError('A v12 import rollback requires databaseConnection, playerUUID, and recoveryUUID');
  }
  const recovery = await databaseConnection.get(STORES.appSetting, recoveryUUID).catch(() => null);
  if (!recovery?.value || String(recovery.parent || '') !== String(playerUUID)) {
    throw new TypeError('Unknown v12 import recovery record');
  }
  if (recovery.value.status === 'restored') return recovery.value;
  const previousEvents = Array.isArray(recovery.value.previousProtocolEvents)
    ? recovery.value.previousProtocolEvents
    : [];
  const previousIds = new Set(previousEvents.map((event) => String(event.UUID)));
  const importedIds = Array.isArray(recovery.value.importedProtocolEventUUIDs)
    ? recovery.value.importedProtocolEventUUIDs.map(String)
    : [];
  const previousCandidateSnapshots = Array.isArray(recovery.value.previousCandidateSnapshots)
    ? recovery.value.previousCandidateSnapshots
    : [];
  const previousCandidateSnapshotIds = new Set(
    previousCandidateSnapshots.map((record) => String(record.UUID)),
  );
  const importedCandidateSnapshotIds = Array.isArray(
    recovery.value.importedCandidateSnapshotUUIDs,
  ) ? recovery.value.importedCandidateSnapshotUUIDs.map(String) : [];
  const updatedAt = new Date().toISOString();
  const restoredRecovery = {
    ...recovery,
    value: {
      ...recovery.value,
      status: 'restored',
      restoredAt: updatedAt,
    },
    updatedAt,
  };
  const puts = [
    ...previousEvents.map((record) => ({ store: STORES.recommenderEvent, record })),
    ...previousCandidateSnapshots.map((record) => ({ store: STORES.appSetting, record })),
    ...(recovery.value.previousCheckpoint
      ? [{ store: STORES.appSetting, record: recovery.value.previousCheckpoint }]
      : []),
    { store: STORES.appSetting, record: restoredRecovery },
  ];
  const deletes = [
    ...importedIds
      .filter((UUID) => !previousIds.has(UUID))
      .map((UUID) => ({ store: STORES.recommenderEvent, UUID })),
    ...(!recovery.value.previousCheckpoint
      ? [{ store: STORES.appSetting, UUID: taskRecommenderV12CheckpointId(playerUUID) }]
      : []),
    ...importedCandidateSnapshotIds
      .filter((UUID) => !previousCandidateSnapshotIds.has(UUID))
      .map((UUID) => ({ store: STORES.appSetting, UUID })),
  ];
  await commitAtomic(databaseConnection, {
    label: 'task-recommender-v12-import-rollback',
    puts,
    deletes,
  });
  return Object.freeze({
    ...restoredRecovery.value,
    durable: true,
  });
}

export async function importTaskRecommendationV12Checkpoint(
  databaseConnection,
  playerUUID,
  payload,
) {
  const contract = parseTaskRecommendationV12CheckpointContract(
    typeof payload === 'string' ? JSON.parse(payload) : payload,
    { playerUUID },
  );
  const previous = await databaseConnection.get(
    STORES.appSetting,
    taskRecommenderV12CheckpointId(playerUUID),
  ).catch(() => null);
  const fingerprint = taskRecommendationV12Fingerprint(contract);
  const updatedAt = new Date().toISOString();
  const recoveryUUID = `${TASK_RECOMMENDATION_V12_RECOVERY_PREFIX}:${playerUUID}:${fingerprint}`;
  await commitAtomic(databaseConnection, {
    label: 'task-recommender-v12-checkpoint-import',
    puts: [
      {
        store: STORES.appSetting,
        record: {
          UUID: recoveryUUID,
          parent: String(playerUUID),
          value: {
            recoverySchemaVersion: 2,
            status: 'available',
            createdAt: updatedAt,
            previousCheckpoint: previous,
            importedFingerprint: fingerprint,
          },
          updatedAt,
        },
      },
      { store: STORES.appSetting, record: checkpointRecord(playerUUID, contract) },
    ],
  });
  reportTaskRecommenderV12Persistence({
    operation: 'import-checkpoint',
    playerUUID,
    payload: contract,
    recordCount: 2,
  });
  return Object.freeze({
    ...contract,
    recoveryUUID,
    durable: true,
  });
}

export const TASK_RECOMMENDATION_V12_PUBLIC_FACADE = Object.freeze({
  facadeVersion: TASK_RECOMMENDATION_V12_FACADE_VERSION,
  contractVersion: TASK_RECOMMENDATION_V12_CONTRACT_VERSION,
  readCheckpoint: readTaskRecommendationV12Checkpoint,
  train: trainTaskRecommendationV12,
  infer: inferTaskRecommendationV12,
  exportBundle: exportTaskRecommendationV12Bundle,
  inspectImport: inspectTaskRecommendationV12Import,
  planImport: planTaskRecommendationV12Import,
  importBundle: importTaskRecommendationV12Bundle,
  resumeImport: resumeTaskRecommendationV12Import,
  rollbackImport: rollbackTaskRecommendationV12Import,
  importCheckpoint: importTaskRecommendationV12Checkpoint,
});
