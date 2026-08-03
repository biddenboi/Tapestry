import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TASK_RECOMMENDATION_V12_IMPORT_MODE,
  buildTaskRecommendationV12ImportContract,
  createTaskRecommendationV12BundleContract,
  createTaskRecommendationV12CheckpointContract,
  createTaskRecommendationV12InferenceRequest,
  createTaskRecommendationV12InferenceResult,
  createTaskRecommendationV12TrainingContract,
  createTaskRecommendationV12TrainingRequest,
  createTaskRecommendationV12TrainingResult,
  findTaskRecommendationV12RemovedProtocolFields,
  parseTaskRecommendationV12BundleContract,
} from './TaskRecommendationV12Contracts.js';

const exportedAt = '2026-07-11T12:00:00.000Z';
const model = {
  modelVersion: 3,
  dimensions: { event: 48 },
  posterior: { updateCount: 4 },
  safetyPosterior: { updateCount: 4 },
};
const event = {
  UUID: 'task-rec-v12:decision-1',
  parent: 'player-1',
  protocolFamily: 'task-recommender-v12',
  protocolVersion: 1,
  sequence: 1,
  type: 'recommendation_decision_created',
  occurredAt: exportedAt,
  taskUUID: 'task-1',
  payload: { durationSeconds: 900 },
};

function checkpoint() {
  return createTaskRecommendationV12CheckpointContract({
    playerUUID: 'player-1',
    model,
    targetModel: model,
    manifest: { status: 'promoted' },
    exportedAt,
  });
}

function trainingData() {
  return createTaskRecommendationV12TrainingContract({
    playerUUID: 'player-1',
    events: [event],
    cursor: { throughSequence: 1 },
    exportedAt,
  });
}

test('checkpoint and training contracts are versioned, portable, and profile-scoped', () => {
  const checkpointContract = checkpoint();
  const trainingContract = trainingData();
  assert.equal(checkpointContract.formatVersion, 1);
  assert.equal(checkpointContract.checkpoint.model.modelVersion, 3);
  assert.equal(trainingContract.protocolSchemaVersion, 2);
  assert.equal(trainingContract.events[0].UUID, event.UUID);
  assert.throws(() => createTaskRecommendationV12TrainingContract({
    playerUUID: 'player-2',
    events: [event],
    exportedAt,
  }), /another profile/);
});


test('training contracts never rewrite removed v11 protocol fields', () => {
  const contaminated = {
    ...event,
    payload: {
      durationSeconds: 900,
      proxyHeads: { accept: 1 },
      weights: { bias: 0.4 },
      semanticFeatures: [1, 2],
      planningAuthority: 'v11',
      durationLadders: [300, 900],
      nested: {
        utilityWeights: [0.2],
        semanticVector: [0.1],
        durationBuckets: [600],
      },
    },
  };
  const contract = createTaskRecommendationV12TrainingContract({
    playerUUID: 'player-1',
    events: [contaminated],
    exportedAt,
  });
  assert.deepEqual(findTaskRecommendationV12RemovedProtocolFields(contract.events), []);
  assert.equal(contract.events[0].payload.durationSeconds, 900);
  assert.deepEqual(contract.events[0].payload.nested, {});
});

test('training request and result contracts carry a checkpoint and explicit cursor', () => {
  const request = createTaskRecommendationV12TrainingRequest({
    requestId: 'train-1',
    playerUUID: 'player-1',
    options: { maxSteps: 32, useWorker: false },
  });
  const result = createTaskRecommendationV12TrainingResult({
    request,
    status: 'promoted',
    checkpoint: checkpoint(),
    metrics: { validationLoss: 0.12 },
    trainedThroughSequence: 9,
  });
  assert.equal(result.requestId, 'train-1');
  assert.equal(result.trainedThroughSequence, 9);
  assert.equal(result.checkpoint.playerUUID, 'player-1');
});

test('inference contracts preserve empty and selected recommendation behavior', () => {
  const request = createTaskRecommendationV12InferenceRequest({
    requestId: 'infer-1',
    playerUUID: 'player-1',
    source: 'tasks',
    decisionSeed: 'seed-1',
    now: exportedAt,
    tasks: [{ UUID: 'task-1', parent: 'player-1', name: 'Draft' }],
  });
  const selected = createTaskRecommendationV12InferenceResult({
    request,
    mode: 'production-v12',
    selected: { actionKey: 'task-1:900', taskUUID: 'task-1', durationSeconds: 900 },
    behaviorProbability: 0.25,
  });
  const empty = createTaskRecommendationV12InferenceResult({ request, mode: 'empty' });
  assert.equal(selected.selected.taskUUID, 'task-1');
  assert.equal(selected.behaviorProbability, 0.25);
  assert.equal(empty.selected, null);
  assert.throws(() => createTaskRecommendationV12InferenceResult({
    request,
    selected: { actionKey: 'bad', taskUUID: 'task-1', durationSeconds: 0 },
  }), /positive/);
});

test('export and import contracts commit v12 artifacts atomically with v12 recovery evidence', () => {
  const bundle = createTaskRecommendationV12BundleContract({
    playerUUID: 'player-1',
    checkpoint: checkpoint(),
    trainingData: trainingData(),
    recoveryEvidence: {
      evidenceVersion: 1,
      activeRuntime: 'v12',
      fingerprint: 'fnv1a32:abc:10',
      checkpointId: 'task-recommender-v12-checkpoint:player-1',
    },
    exportedAt,
  });
  const roundTrip = parseTaskRecommendationV12BundleContract(JSON.stringify(bundle));
  const importContract = buildTaskRecommendationV12ImportContract(roundTrip, {
    targetPlayerUUID: 'player-1',
  });
  assert.equal(roundTrip.format, 'tapestry-task-recommender-v12-bundle');
  assert.equal(roundTrip.formatVersion, 2);
  assert.equal(importContract.mode, TASK_RECOMMENDATION_V12_IMPORT_MODE);
  assert.equal(importContract.writesActiveArtifacts, true);
  assert.equal(importContract.requiresExplicitCutoverCommit, false);
  assert.equal(importContract.recoveryEvidence.activeRuntime, 'v12');
  assert.equal(importContract.recoveryEvidence.fingerprint, 'fnv1a32:abc:10');
  assert.equal('rollbackEvidence' in importContract, false);
});
