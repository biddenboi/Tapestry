import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createTaskRecommendationV12BundleContract,
  createTaskRecommendationV12CheckpointContract,
  createTaskRecommendationV12TrainingContract,
} from './TaskRecommendationV12Contracts.js';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const contractsUrl = new URL('./TaskRecommendationV12Contracts.js', import.meta.url).href;
const ledgerUrl = dataUrl(`
  export const getTaskRecommenderProtocolEvents = async (db, playerUUID) =>
    (await db.getPlayerStore('taskRecommendations', playerUUID))
      .filter((row) => row.protocolFamily === 'task-recommender-v12');
`);
const trainingUrl = dataUrl(`
  export const TASK_RECOMMENDER_V12_TRAINING_DEFERRAL_PREFIX = 'task-recommender-v12-training-deferral';
  export const taskRecommenderV12CheckpointId = (playerUUID) => 'task-recommender-v12-checkpoint:' + playerUUID;
  export const getTaskRecommenderV12Checkpoint = async (db, playerUUID) => {
    const record = await db.get('appSettings', 'task-recommender-v12-checkpoint:' + playerUUID).catch(() => null);
    return record?.value || globalThis.__facadeCheckpoint;
  };
  export const trainTaskRecommenderV12 = async () => ({
    promoted: true, candidatePolicyManifest: { policyUUID: 'candidate-test' },
    trainedThroughSequence: 4, metrics: { validationLoss: 0.1 }, checkpoint: {},
  });
`);
const modelUrl = dataUrl('export const serializeTaskRecommenderV12Model = (model) => structuredClone(model);');
const servingUrl = dataUrl(`
  export const evaluateTaskRecommenderV12 = async (input) => input.todos.length === 0 ? null : ({
    servingSchemaVersion: 2,
    mode: 'production-v12', shouldServeV12: true,
    recommendation: {
      actionKey: input.todos[0].UUID + ':900', taskUUID: input.todos[0].UUID,
      durationSeconds: 900, predictedWorkHours: 0.2, epistemicStdDevHours: 0.1,
    },
    policyDecision: {
      policyVersion: 'dual-head-safe-v4',
      selected: { jointBehaviorProbability: 0.5 },
    },
    device: { hydrationMs: 2, scoringMs: 3, totalMs: 5, actionCount: 1 },
  });
`);
const candidateEvidenceUrl = dataUrl(`
  export const TASK_RECOMMENDER_V12_TASK_SNAPSHOT_PREFIX = 'task-recommender-v12-task-snapshot';
`);
const runtimeUrl = dataUrl(`
  export const assertTaskRecommenderV12RuntimeReady = async () => null;
  export const getTaskRecommenderV12MigrationState = async () => null;
`);
const reporterUrl = dataUrl(`
  export const reportTaskRecommenderV12Persistence = () => null;
  export const reportTaskRecommenderV12Inference = () => null;
`);
const registryUrl = dataUrl(`
  export const TASK_RECOMMENDER_V12_POLICY_MANIFEST_PREFIX = 'task-recommender-v12-policy';
  export const ensureTaskRecommenderV12PolicyRegistry = async () => ({
    pointer: { championPolicyUUID: 'current-test' },
  });
  export const registerTaskRecommenderV12PolicyCandidate = async () => ({ policyUUID: 'ablation-test' });
  export const promoteTaskRecommenderV12Champion = async () => ({ pointer: {} });
  export const rollbackTaskRecommenderV12Champion = async () => ({ pointer: {} });
  export const saveTaskRecommenderV12Experiment = async (db, input) => input;
`);
const evidenceUrl = dataUrl(`
  export const buildTaskRecommenderV12EvidenceReport = () => ({ policyMetrics: {} });
  export const evaluateTaskRecommenderV12Promotion = () => ({ eligible: false });
`);
let source = await readFile(new URL('./TaskRecommendationV12.js', import.meta.url), 'utf8');
source = source
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings', recommenderEvent: 'taskRecommendations' };")
  .replace("from './TaskRecommenderLedger.js';", `from '${ledgerUrl}';`)
  .replace("from './TaskRecommenderV12Training.js';", `from '${trainingUrl}';`)
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`)
  .replace("from './TaskRecommenderV12Serving.js';", `from '${servingUrl}';`)
  .replace("from './TaskRecommenderV12CandidateEvidence.js';", `from '${candidateEvidenceUrl}';`)
  .replace("from './TaskRecommenderV12RuntimeState.js';", `from '${runtimeUrl}';`)
  .replace("from './TaskRecommendationV12Contracts.js';", `from '${contractsUrl}';`)
  .replace("from './TaskRecommenderV12DevelopmentReporter.js';", `from '${reporterUrl}';`)
  .replace("from './TaskRecommenderV12PolicyRegistry.js';", `from '${registryUrl}';`)
  .replace("from './TaskRecommenderV12Evidence.js';", `from '${evidenceUrl}';`);
const facade = await import(dataUrl(source));

class MemoryDb {
  records = new Map();
  commits = [];
  key(store, UUID) { return `${store}:${UUID}`; }
  async get(store, UUID) { return this.records.get(this.key(store, UUID)) || null; }
  async add(store, record) { this.records.set(this.key(store, record.UUID), structuredClone(record)); return record; }
  async delete(store, UUID) { this.records.delete(this.key(store, UUID)); }
  async getPlayerStore(store, parent) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, record]) => structuredClone(record))
      .filter((record) => String(record.parent) === String(parent));
  }
  async commitAtomicMutation(mutation) {
    this.commits.push(structuredClone(mutation));
    for (const entry of mutation.puts || []) await this.add(entry.store, entry.record);
    for (const entry of mutation.deletes || []) await this.delete(entry.store, entry.UUID);
    return { changed: true, label: mutation.label };
  }
}

const model = {
  modelVersion: 3,
  dimensions: { event: 48 },
  posterior: { updateCount: 2 },
  safetyPosterior: { updateCount: 2 },
};
globalThis.__facadeCheckpoint = {
  model,
  targetModel: structuredClone(model),
  manifest: { status: 'promoted' },
};
const exportedAt = '2026-07-11T12:00:00.000Z';

function protocolEvent(UUID, taskUUID = 'task-1') {
  return {
    UUID, parent: 'player-1', protocolFamily: 'task-recommender-v12', protocolVersion: 1,
    sequence: 1, type: 'recommendation_decision_created', occurredAt: exportedAt,
    decisionUUID: 'decision-1', idempotencyKey: 'decision-1:created', taskUUID, payload: {},
  };
}

function candidateSnapshot(UUID = 'task-recommender-v12-task-snapshot:player-1:hash-1') {
  return {
    UUID, parent: 'player-1', updatedAt: exportedAt,
    value: {
      taskSnapshotRecordVersion: 1, encoderVersion: 2, contentHash: 'hash-1',
      snapshot: { UUID: 'task-1', parent: 'player-1', name: 'Draft', contentHash: 'hash-1' },
    },
  };
}

function bundle(events = [protocolEvent('imported-event')]) {
  const checkpoint = createTaskRecommendationV12CheckpointContract({
    playerUUID: 'player-1', model, targetModel: model, manifest: { status: 'promoted' }, exportedAt,
  });
  return createTaskRecommendationV12BundleContract({
    playerUUID: 'player-1', checkpoint,
    trainingData: createTaskRecommendationV12TrainingContract({
      playerUUID: 'player-1', events, exportedAt, cursor: { throughSequence: 1 },
    }),
    recoveryEvidence: {
      evidenceVersion: 1, activeRuntime: 'v12', fingerprint: 'source-fingerprint',
      checkpointId: 'task-recommender-v12-checkpoint:player-1', protocolEventIds: events.map((event) => event.UUID),
    },
    candidateSnapshots: [candidateSnapshot()],
    exportedAt,
  });
}

test('public facade exposes v12 checkpoint, training, and production inference contracts', async () => {
  const db = new MemoryDb();
  const checkpoint = await facade.readTaskRecommendationV12Checkpoint(db, 'player-1');
  assert.equal(checkpoint.playerUUID, 'player-1');
  const training = await facade.trainTaskRecommendationV12(db, {
    requestId: 'train-1', playerUUID: 'player-1', options: { maxSteps: 2 },
  });
  assert.equal(training.status, 'candidate-ready');
  const inference = await facade.inferTaskRecommendationV12(db, {
    requestId: 'infer-1', playerUUID: 'player-1', decisionSeed: 'seed',
    now: exportedAt, tasks: [{ UUID: 'task-1', parent: 'player-1' }],
  });
  assert.equal(inference.mode, 'production-v12');
  assert.equal(inference.selected.taskUUID, 'task-1');
  assert.deepEqual(Object.keys(inference.selected).sort(), [
    'actionKey', 'durationSeconds', 'epistemicStdDevHours', 'predictedWorkHours', 'taskUUID',
  ]);
  assert.equal('policyDecision' in inference.diagnostics, false);
  assert.equal(
    facade.getTaskRecommendationV12PrivateInferenceState(inference).policyDecision.policyVersion,
    'dual-head-safe-v4',
  );
  const empty = await facade.inferTaskRecommendationV12(db, {
    requestId: 'infer-empty', playerUUID: 'player-1', decisionSeed: 'seed-empty',
    now: exportedAt, tasks: [],
  });
  assert.equal(empty.mode, 'empty');
  assert.equal(empty.selected, null);
});

test('v12 bundle export contains only checkpoint, protocol facts, and v12 recovery evidence', async () => {
  const db = new MemoryDb();
  await db.add('taskRecommendations', protocolEvent('v12-event'));
  await db.add('appSettings', candidateSnapshot());
  const exported = await facade.exportTaskRecommendationV12Bundle(db, 'player-1');
  assert.equal(exported.formatVersion, 2);
  assert.equal(exported.trainingData.events.length, 1);
  assert.equal(exported.candidateSnapshots.length, 1);
  assert.equal(exported.recoveryEvidence.activeRuntime, 'v12');
  assert.match(exported.recoveryEvidence.fingerprint, /^fnv1a32:/);
  assert.equal('rollbackEvidence' in exported, false);
  const plan = facade.planTaskRecommendationV12Import(exported);
  assert.equal(plan.writesActiveArtifacts, true);
  assert.equal(plan.cutoverTransaction.type, 'atomic-batch');
});

test('v12 bundle import is atomic, immediately durable, and rolls back only to v12 state', async () => {
  const db = new MemoryDb();
  const previousCheckpoint = {
    UUID: 'task-recommender-v12-checkpoint:player-1', parent: 'player-1',
    value: { model: { modelVersion: 2, marker: 'previous' }, targetModel: { modelVersion: 2 }, manifest: {} },
  };
  const previousEvent = protocolEvent('previous-event', 'task-old');
  await db.add('appSettings', previousCheckpoint);
  await db.add('taskRecommendations', previousEvent);
  const imported = await facade.importTaskRecommendationV12Bundle(db, 'player-1', bundle());
  assert.equal(imported.status, 'complete');
  assert.equal(imported.durable, true);
  assert.equal(db.commits.at(-1).label, 'task-recommender-v12-import');
  assert.ok(await db.get('taskRecommendations', 'imported-event'));
  assert.ok(await db.get('appSettings', candidateSnapshot().UUID));
  const recovery = await db.get('appSettings', imported.recoveryUUID);
  assert.equal(recovery.value.boundary, 'v12-only');
  assert.equal(recovery.value.previousProtocolEvents[0].UUID, 'previous-event');

  const resumed = await facade.resumeTaskRecommendationV12Import(
    db,
    'player-1',
    `${facade.TASK_RECOMMENDATION_V12_IMPORT_RECEIPT_PREFIX}:player-1:${imported.fingerprint}`,
  );
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.durable, true);

  const rolledBack = await facade.rollbackTaskRecommendationV12Import(db, 'player-1', imported.recoveryUUID);
  assert.equal(rolledBack.status, 'restored');
  assert.equal((await db.get('appSettings', previousCheckpoint.UUID)).value.model.marker, 'previous');
  assert.ok(await db.get('taskRecommendations', 'previous-event'));
  assert.equal(await db.get('taskRecommendations', 'imported-event'), null);
  assert.equal(await db.get('appSettings', candidateSnapshot().UUID), null);
});


test('v12 checkpoints and outcomes round-trip through bundle export and import', async () => {
  const sourceDb = new MemoryDb();
  await sourceDb.add('taskRecommendations', protocolEvent('roundtrip-event'));
  await sourceDb.add('appSettings', candidateSnapshot());
  const exported = await facade.exportTaskRecommendationV12Bundle(sourceDb, 'player-1');

  const targetDb = new MemoryDb();
  const imported = await facade.importTaskRecommendationV12Bundle(targetDb, 'player-1', exported);
  assert.equal(imported.status, 'complete');
  const reexported = await facade.exportTaskRecommendationV12Bundle(targetDb, 'player-1');

  assert.deepEqual(reexported.checkpoint.checkpoint.model, exported.checkpoint.checkpoint.model);
  assert.deepEqual(reexported.checkpoint.checkpoint.targetModel, exported.checkpoint.checkpoint.targetModel);
  assert.deepEqual(
    reexported.trainingData.events.map((event) => event.UUID),
    exported.trainingData.events.map((event) => event.UUID),
  );
  assert.deepEqual(reexported.candidateSnapshots, exported.candidateSnapshots);
});
