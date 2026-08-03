import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mathSource = await readFile(new URL('./TaskRecommenderV12Math.js', import.meta.url), 'utf8');
const mathUrl = `data:text/javascript;base64,${Buffer.from(mathSource).toString('base64')}`;
const protocolSource = await readFile(new URL('./TaskRecommenderProtocol.js', import.meta.url), 'utf8');
const protocolUrl = `data:text/javascript;base64,${Buffer.from(protocolSource).toString('base64')}`;
const protocol = await import(protocolUrl);
const encodingSource = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encodingUrl = `data:text/javascript;base64,${Buffer.from(encodingSource).toString('base64')}`;
const encoding = await import(encodingUrl);
const modelSourceRaw = await readFile(new URL('./TaskRecommenderV12Model.js', import.meta.url), 'utf8');
const modelSource = modelSourceRaw.replace("from './TaskRecommenderV12Math.js';", `from '${mathUrl}';`);
const modelUrl = `data:text/javascript;base64,${Buffer.from(modelSource).toString('base64')}`;
const model = await import(modelUrl);
const sequentialSource = await readFile(
  new URL('./TaskRecommenderV12Sequential.js', import.meta.url),
  'utf8',
);
const sequentialUrl = `data:text/javascript;base64,${Buffer.from(sequentialSource).toString('base64')}`;
const policySourceRaw = await readFile(
  new URL('./TaskRecommenderV12Policy.js', import.meta.url),
  'utf8',
);
const policySource = policySourceRaw
  .replace("from './TaskRecommenderV12Encoding.js';", `from '${encodingUrl}';`)
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`)
  .replace("from './TaskRecommenderV12Math.js';", `from '${mathUrl}';`);
const policyUrl = `data:text/javascript;base64,${Buffer.from(policySource).toString('base64')}`;
const representationTrainingSource = await readFile(
  new URL('./TaskRecommenderV12RepresentationTraining.js', import.meta.url),
  'utf8',
);
const representationTrainingUrl = `data:text/javascript;base64,${Buffer.from(
  representationTrainingSource,
).toString('base64')}`;
const coreSourceRaw = await readFile(new URL('./TaskRecommenderV12TrainingCore.js', import.meta.url), 'utf8');
const coreSource = coreSourceRaw
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`)
  .replace("from './TaskRecommenderV12Encoding.js';", `from '${encodingUrl}';`)
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`)
  .replace("from './TaskRecommenderV12Math.js';", `from '${mathUrl}';`)
  .replace("from './TaskRecommenderV12Policy.js';", `from '${policyUrl}';`)
  .replace(
    "from './TaskRecommenderV12RepresentationTraining.js';",
    `from '${representationTrainingUrl}';`,
  )
  .replace("from './TaskRecommenderV12Sequential.js';", `from '${sequentialUrl}';`);
const coreUrl = `data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`;
const core = await import(coreUrl);

const ledgerSourceRaw = await readFile(new URL('./TaskRecommenderLedger.js', import.meta.url), 'utf8');
const ledgerSource = ledgerSourceRaw
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { recommenderEvent: 'taskRecommendations' };",
  )
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`);
const ledgerUrl = `data:text/javascript;base64,${Buffer.from(ledgerSource).toString('base64')}`;

const settingsSource = (await readFile(
  new URL('./TaskRecommenderV12Settings.js', import.meta.url),
  'utf8',
)).replace(
  "import { STORES } from '@domain/constants.js';",
  "const STORES = { appSetting: 'appSettings' };",
);
const settingsUrl = `data:text/javascript;base64,${Buffer.from(settingsSource).toString('base64')}`;
const registryUrl = `data:text/javascript;base64,${Buffer.from(`
  export async function ensureTaskRecommenderV12PolicyRegistry(db, playerUUID) {
    return { pointer: { championPolicyUUID: 'current-test' }, champion: {} };
  }
  export async function registerTaskRecommenderV12PolicyCandidate() {
    return { runtime: 'v12', role: 'candidate', policyUUID: 'candidate-test' };
  }
`).toString('base64')}`;

const trainingSourceRaw = await readFile(new URL('./TaskRecommenderV12Training.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('./TaskRecommenderV12TrainingWorker.js', import.meta.url), 'utf8');
const trainingSource = trainingSourceRaw
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { appSetting: 'appSettings' };",
  )
  .replace("from './TaskRecommenderLedger.js';", `from '${ledgerUrl}';`)
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`)
  .replace("from './TaskRecommenderV12TrainingCore.js';", `from '${coreUrl}';`)
  .replace("from './TaskRecommenderV12Settings.js';", `from '${settingsUrl}';`);
const patchedTrainingSource = trainingSource.replace(
  "from './TaskRecommenderV12PolicyRegistry.js';",
  `from '${registryUrl}';`,
);
const training = await import(`data:text/javascript;base64,${Buffer.from(patchedTrainingSource).toString('base64')}`);

class MemoryDb {
  records = new Map();

  async get(store, UUID) {
    return this.records.get(`${store}:${UUID}`) || null;
  }

  async add(store, record) {
    this.records.set(`${store}:${record.UUID}`, record);
    return record;
  }

  async getPlayerStore(store, parent) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, record]) => record)
      .filter((record) => record.parent === parent);
  }
}

function makeTrainingEvents(count = 12) {
  const events = [];
  let sequence = 1;
  for (let index = 0; index < count; index += 1) {
    const decisionUUID = `decision-${index}`;
    const taskUUID = index % 2 ? 'task-work' : 'task-skip';
    const occurredAt = new Date(Date.UTC(2026, 6, 1 + index, 12)).toISOString();
    const taskSnapshot = encoding.createTaskRecommenderV12TaskSnapshot({
      UUID: taskUUID,
      name: taskUUID === 'task-work' ? 'Write project section' : 'Sort notes',
      description: taskUUID === 'task-work' ? '- Draft\n- Review' : '',
      estimatedDuration: taskUUID === 'task-work' ? 30 : 10,
      dueDate: new Date(Date.UTC(2026, 6, 20, 12)).toISOString(),
    });
    const base = { playerUUID: 'player-1', decisionUUID, taskUUID, source: 'dojo' };
    events.push(protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
      eventKey: 'created',
      sequence: sequence++,
      occurredAt,
      payload: {
        taskSnapshot,
        proposedDurationSeconds: taskUUID === 'task-work' ? 1800 : 600,
        behaviorProbability: 0.5,
      },
    }));
    events.push(protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented,
      eventKey: 'presented',
      sequence: sequence++,
      occurredAt,
      payload: {},
    }));
    if (taskUUID === 'task-work') {
      events.push(protocol.createTaskRecommenderProtocolEvent({
        ...base,
        type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationAccepted,
        eventKey: 'accepted',
        sequence: sequence++,
        occurredAt,
        payload: { acceptedDurationSeconds: 1800 },
      }));
      events.push(protocol.createTaskRecommenderProtocolEvent({
        ...base,
        type: protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished,
        eventKey: 'finished',
        sequence: sequence++,
        occurredAt: new Date(new Date(occurredAt).getTime() + 30 * 60 * 1000).toISOString(),
        payload: {
          productiveSeconds: 1800,
          committedSeconds: 1800,
          sessionTimingSchemaVersion: protocol.TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION,
          sessionStartedAt: occurredAt,
          sessionFinishedAt: new Date(
            new Date(occurredAt).getTime() + 30 * 60 * 1000,
          ).toISOString(),
        },
      }));
    } else {
      events.push(protocol.createTaskRecommenderProtocolEvent({
        ...base,
        type: protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped,
        eventKey: 'skipped',
        sequence: sequence++,
        occurredAt,
        payload: { reason: 'scroll-past' },
      }));
    }
  }
  return events;
}

test('resolved examples use only verified work seconds and skip resolves to zero', () => {
  const examples = core.buildTaskRecommenderV12ResolvedExamples(makeTrainingEvents(4));
  assert.equal(examples.length, 4);
  assert.deepEqual(examples.map((example) => example.targetWorkHours), [0, 0.5, 0, 0.5]);
  assert.deepEqual(examples.map((example) => example.terminalStatus), [
    'skipped', 'session-finished', 'skipped', 'session-finished',
  ]);
  assert.deepEqual(examples.map((example) => example.rewardAtoms.length), [0, 1, 0, 1]);
  assert.ok(examples.every((example) => example.rewardTimingVerified));
  assert.equal(examples[1].rewardAtoms[0].productiveSeconds, 1800);
  assert.equal(
    new Date(examples[1].rewardAtoms[0].occurredAt).getTime()
      - new Date(examples[1].occurredAt).getTime(),
    30 * 60 * 1000,
  );
});

test('legacy finish events remain readable but do not claim verified reward timing', () => {
  const events = structuredClone(makeTrainingEvents(2));
  const finished = events.find((event) => (
    event.type === protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished
  ));
  delete finished.payload.sessionTimingSchemaVersion;
  delete finished.payload.sessionStartedAt;
  delete finished.payload.sessionFinishedAt;
  const examples = core.buildTaskRecommenderV12ResolvedExamples(events);
  const work = examples.find((example) => example.productiveSeconds > 0);
  assert.equal(work.targetWorkHours, 0.5);
  assert.equal(work.rewardAtoms.length, 1);
  assert.equal(work.rewardTimingVerified, false);
  assert.equal(work.rewardAtoms[0].timingVerified, false);
});

test('replay index is deterministic, bounded, and retains recent decisions', () => {
  const examples = core.buildTaskRecommenderV12ResolvedExamples(makeTrainingEvents(30));
  const first = core.buildTaskRecommenderV12ReplayIndex(examples, {
    maxEntries: 10,
    recentFraction: 0.6,
    seed: 'replay-test',
  });
  const second = core.buildTaskRecommenderV12ReplayIndex(examples, {
    maxEntries: 10,
    recentFraction: 0.6,
    seed: 'replay-test',
  });
  assert.deepEqual(first, second);
  assert.equal(first.length, 10);
  assert.deepEqual(first.slice(-6).map((entry) => entry.decisionUUID), examples.slice(-6).map((entry) => entry.decisionUUID));
  assert.ok(first.every((entry) => !('tensor' in entry) && !('encodedAction' in entry)));
});

test('historical candidate evidence reconstructs a changed target policy exactly', () => {
  const targetModel = model.createTaskRecommenderV12Model({ seed: 'target-reconstruction' });
  const occurredAt = '2026-07-11T12:00:00.000Z';
  const snapshots = [
    encoding.createTaskRecommenderV12TaskSnapshot({
      UUID: 'task-a', name: 'Draft section', estimatedDuration: 15,
    }),
    encoding.createTaskRecommenderV12TaskSnapshot({
      UUID: 'task-b', name: 'Review notes', estimatedDuration: 15,
    }),
  ];
  const snapshotIds = ['snapshot:a', 'snapshot:b'];
  const actions = snapshots.map((snapshot) => ({
    actionKey: `${snapshot.UUID}:900`,
    taskUUID: snapshot.UUID,
    durationSeconds: 900,
    durationQuantumSeconds: 60,
    taskSnapshot: snapshot,
  }));
  const state = Array(targetModel.dimensions.state).fill(0);
  const encoded = actions.map((action) => encoding.encodeTaskRecommenderV12Action(action, {
    now: occurredAt,
    source: 'dojo',
    queueSize: 2,
    taskExposureByUUID: {},
  }));
  for (let pass = 0; pass < 32; pass += 1) {
    model.updateTaskRecommenderV12Posterior(
      targetModel.posterior,
      model.taskRecommenderV12Representation(targetModel, state, encoded[0]),
      2,
    );
    model.updateTaskRecommenderV12Posterior(
      targetModel.posterior,
      model.taskRecommenderV12Representation(targetModel, state, encoded[1]),
      -2,
    );
  }
  const manifest = {
    candidateManifestVersion: 1,
    actionSchemaVersion: encoding.TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
    encoderVersion: encoding.TASK_RECOMMENDER_V12_ENCODER_VERSION,
    occurredAt,
    source: 'dojo',
    taskCount: 2,
    actionCount: 2,
    snapshots: snapshots.map((snapshot, index) => ({
      snapshotUUID: snapshotIds[index],
      taskUUID: snapshot.UUID,
      contentHash: snapshot.contentHash,
    })),
    actions: actions.map((action, index) => ({
      actionKey: action.actionKey,
      actionSchemaVersion: encoding.TASK_RECOMMENDER_V12_ACTION_SCHEMA_VERSION,
      taskUUID: action.taskUUID,
      durationSeconds: action.durationSeconds,
      durationQuantumSeconds: action.durationQuantumSeconds,
      snapshotUUID: snapshotIds[index],
      contentHash: snapshots[index].contentHash,
    })),
  };
  const policyDecision = {
    rngRecipe: { seed: 'historical-seed', posteriorSampleCount: 512 },
    evidence: { minimumChampionEvidence: 8 },
    support: { requestedTaskFloor: 0.01, requestedDurationFloor: 0.01 },
    safety: {
      openingAvailableBudgetHours: 0,
      safetyFraction: 0.1,
      requestedExplorationMixture: 1,
    },
  };
  const examples = actions.map((action, index) => ({
    decisionUUID: `exact-${index}`,
    decisionSequence: index + 1,
    occurredAt,
    source: 'dojo',
    taskUUID: action.taskUUID,
    actionKey: action.actionKey,
    taskSnapshot: snapshots[index],
    candidateManifest: manifest,
    policyDecision,
    proposedDurationSeconds: 900,
    behaviorProbability: 0.5,
    targetWorkHours: 0,
    rewardAtoms: [],
    rewardTimingVerified: true,
  }));
  const snapshotsByUUID = Object.fromEntries(snapshotIds.map((id, index) => [
    id,
    snapshots[index],
  ]));
  const result = core.buildTaskRecommenderV12SequentialTargets(
    targetModel,
    [],
    examples,
    { candidateSnapshotsByUUID: snapshotsByUUID },
  );
  assert.equal(result.diagnostics.targetPolicyReconstruction.exact, 2);
  assert.equal(result.diagnostics.targetPolicyReconstruction.unsupported, 0);
  assert.equal(result.diagnostics.targetPolicyReconstruction.ratioDifferentFromOne, 2);
  assert.ok(result.diagnostics.clippedImportanceRatios >= 1);

  const unsupported = core.reconstructTaskRecommenderV12TargetProbability(
    targetModel,
    [],
    examples[0],
    { candidateSnapshotsByUUID: {} },
  );
  assert.equal(unsupported.probability, null);
  assert.equal(unsupported.reason, 'missing-or-mismatched-candidate-snapshot');
});

test('auxiliary training updates event and task encoders with finite bounded work', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'auxiliary' });
  const events = makeTrainingEvents(8);
  const beforeWorld = [...valueModel.worldLayer.weights];
  const beforeTask = [...valueModel.taskLayer.weights];
  const eventResult = core.trainTaskRecommenderV12EventAuxiliary(valueModel, events, {
    maxSteps: 16,
    learningRate: 0.001,
  });
  const examples = core.buildTaskRecommenderV12ResolvedExamples(events);
  const encoded = examples.map((example) => core.materializeTaskRecommenderV12Example(
    valueModel,
    events,
    example,
  ).encodedAction);
  const taskResult = core.trainTaskRecommenderV12TaskAuxiliary(valueModel, encoded, {
    maxSteps: 8,
    learningRate: 0.001,
  });
  assert.equal(eventResult.steps, 16);
  assert.equal(taskResult.steps, 8);
  assert.ok(Number.isFinite(eventResult.meanLoss));
  assert.ok(Number.isFinite(taskResult.meanLoss));
  assert.notDeepEqual(valueModel.worldLayer.weights, beforeWorld);
  assert.notDeepEqual(valueModel.taskLayer.weights, beforeTask);
  assert.doesNotThrow(() => model.restoreTaskRecommenderV12Model(
    model.serializeTaskRecommenderV12Model(valueModel),
  ));
});

test('candidate training updates posterior and produces an atomic promotion decision', () => {
  const current = model.createTaskRecommenderV12Model({ seed: 'candidate' });
  const representationBefore = [...current.representationLayer.weights];
  const interactionBefore = [...current.interactionLayer.weights];
  const recurrentBefore = [...current.gru.inputUpdate];
  const result = core.trainTaskRecommenderV12Candidate(current, makeTrainingEvents(18), {
    maxEntries: 18,
    maxSteps: 16,
    learningRate: 0.0001,
    promotionTolerance: 0.1,
  });
  assert.equal(result.resolvedExamples, 18);
  assert.equal(result.replaySize, 18);
  assert.equal(result.promoted, true);
  assert.equal(result.model.posterior.updateCount, 18);
  assert.equal(result.model.safetyPosterior.updateCount, 18);
  assert.ok(Number.isFinite(result.metrics.validation.meanSquaredError));
  assert.equal(result.metrics.delayedCredit.meanTraceLength, 1);
  assert.equal(
    result.metrics.delayedCredit.targetPolicyReconstruction.unsupported,
    18,
  );
  assert.ok(Number.isFinite(
    result.metrics.safetyCalibration.validation.meanAbsoluteCalibrationError,
  ));
  assert.equal(result.metrics.representationTraining.attemptedPhase, 'head-only');
  assert.equal(result.metrics.representationTraining.steps, 0);
  assert.deepEqual(result.model.representationLayer.weights, representationBefore);
  assert.deepEqual(result.model.interactionLayer.weights, interactionBefore);
  assert.deepEqual(result.model.gru.inputUpdate, recurrentBefore);
  assert.equal(result.representationTrainingState.optimizerState.step, 0);
});

test('representation phases advance one successful layer group at a time', () => {
  const events = makeTrainingEvents(18);
  const permissiveThresholds = {
    representation: {
      resolvedDecisions: 0, activeDays: 0, returnCycles: 0, exactPropensityCoverage: 0,
    },
    interaction: {
      resolvedDecisions: 0, activeDays: 0, returnCycles: 0, exactPropensityCoverage: 0,
    },
    recurrent: {
      resolvedDecisions: 0, activeDays: 0, returnCycles: 0, exactPropensityCoverage: 0,
    },
  };
  const common = {
    maxEntries: 18,
    maxSteps: 8,
    valueRepresentationMaxSteps: 8,
    learningRate: 0.0001,
    valueLearningRate: 0.0002,
    promotionTolerance: 100,
    safetyPromotionTolerance: 100,
    representationPhaseThresholds: permissiveThresholds,
  };
  const initial = model.createTaskRecommenderV12Model({ seed: 'progressive-phases' });
  const initialRepresentation = [...initial.representationLayer.weights];
  const initialInteraction = [...initial.interactionLayer.weights];
  const initialRecurrent = [...initial.gru.inputUpdate];

  const representation = core.trainTaskRecommenderV12Candidate(initial, events, common);
  assert.equal(representation.promoted, true);
  assert.equal(representation.representationTrainingState.phase, 'representation');
  assert.equal(representation.metrics.representationTraining.steps, 8);
  assert.notDeepEqual(representation.model.representationLayer.weights, initialRepresentation);
  assert.deepEqual(representation.model.interactionLayer.weights, initialInteraction);
  assert.deepEqual(representation.model.gru.inputUpdate, initialRecurrent);
  assert.ok(
    representation.metrics.representationTraining.trustRegion
      .representationLayer.afterProjection <= 0.05 + 1e-12,
  );
  assert.ok(Object.keys(
    representation.representationTrainingState.optimizerState.moments,
  ).every((key) => key.startsWith('representationLayer.')));

  const interactionBefore = [...representation.model.interactionLayer.weights];
  const recurrentBefore = [...representation.model.gru.inputUpdate];
  const interaction = core.trainTaskRecommenderV12Candidate(
    representation.model,
    events,
    { ...common, representationTrainingState: representation.representationTrainingState },
  );
  assert.equal(interaction.promoted, true);
  assert.equal(interaction.representationTrainingState.phase, 'interaction');
  assert.notDeepEqual(interaction.model.interactionLayer.weights, interactionBefore);
  assert.deepEqual(interaction.model.gru.inputUpdate, recurrentBefore);
  assert.ok(
    interaction.metrics.representationTraining.trustRegion
      .interactionLayer.afterProjection <= 0.04 + 1e-12,
  );
  assert.ok(interaction.representationTrainingState.optimizerState.step
    > representation.representationTrainingState.optimizerState.step);

  const matureRecurrentBefore = [...interaction.model.gru.inputUpdate];
  const recurrent = core.trainTaskRecommenderV12Candidate(
    interaction.model,
    events,
    { ...common, representationTrainingState: interaction.representationTrainingState },
  );
  assert.equal(recurrent.promoted, true);
  assert.equal(recurrent.representationTrainingState.phase, 'recurrent');
  assert.notDeepEqual(recurrent.model.gru.inputUpdate, matureRecurrentBefore);
  assert.ok(
    recurrent.metrics.representationTraining.trustRegion.gru.afterProjection
      <= 0.02 + 1e-12,
  );
  assert.equal(
    recurrent.representationTrainingState.trainableLayerMask.recurrentValue,
    true,
  );
  assert.equal(recurrent.representationTrainingState.phasePromotionCount, 3);
});

test('a rejected representation candidate atomically rolls back model and optimizer phase', () => {
  const events = makeTrainingEvents(18);
  const cold = model.createTaskRecommenderV12Model({ seed: 'representation-rollback' });
  const established = core.trainTaskRecommenderV12Candidate(cold, events, {
    maxEntries: 18,
    maxSteps: 8,
    promotionTolerance: 100,
    safetyPromotionTolerance: 100,
  });
  assert.equal(established.promoted, true);
  const beforeModel = model.serializeTaskRecommenderV12Model(established.model);
  const beforeState = structuredClone(established.representationTrainingState);
  const shiftedEvents = structuredClone(events);
  for (const event of shiftedEvents) {
    const index = Number(String(event.decisionUUID).split('-').at(-1));
    if (!(index < 15)) continue;
    if (event.type === protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped) {
      event.type = protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished;
      event.payload = {
        productiveSeconds: 7_200,
        sessionTimingSchemaVersion:
          protocol.TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION,
        sessionStartedAt: event.occurredAt,
        sessionFinishedAt: event.occurredAt,
      };
    } else if (event.type === protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished) {
      event.payload.productiveSeconds = 0;
    }
  }
  const rejected = core.trainTaskRecommenderV12Candidate(established.model, shiftedEvents, {
    maxEntries: 18,
    maxSteps: 8,
    valueRepresentationMaxSteps: 15,
    valueLearningRate: 0.002,
    representationTrustRadii: { representationLayer: 2 },
    promotionTolerance: -1,
    safetyPromotionTolerance: -1,
    representationTrainingState: beforeState,
    representationPhaseThresholds: {
      representation: {
        resolvedDecisions: 0, activeDays: 0, returnCycles: 0, exactPropensityCoverage: 0,
      },
      interaction: {
        resolvedDecisions: 999, activeDays: 999, returnCycles: 999,
        exactPropensityCoverage: 1,
      },
      recurrent: {
        resolvedDecisions: 999, activeDays: 999, returnCycles: 999,
        exactPropensityCoverage: 1,
      },
    },
  });
  assert.equal(rejected.promoted, false);
  assert.equal(rejected.metrics.representationTraining.rolledBack, true);
  assert.deepEqual(model.serializeTaskRecommenderV12Model(rejected.model), beforeModel);
  assert.deepEqual(rejected.representationTrainingState, beforeState);
});

test('persisted training recovers, serializes same-player jobs, and stores a manifest', async () => {
  const db = new MemoryDb();
  for (const event of makeTrainingEvents(12)) await db.add('taskRecommendations', event);
  const [first, second] = await Promise.all([
    training.trainTaskRecommenderV12(db, 'player-1', { maxSteps: 8, promotionTolerance: 0.2 }),
    training.trainTaskRecommenderV12(db, 'player-1', { maxSteps: 8, promotionTolerance: 0.2 }),
  ]);
  assert.ok(first.checkpoint.manifest.updatedAt);
  assert.ok(second.checkpoint.manifest.updatedAt);
  const stored = await db.get('appSettings', 'task-recommender-v12-checkpoint:player-1');
  assert.equal(stored.parent, 'player-1');
  assert.ok(stored.value.model.posterior.updateCount > 0);
  assert.ok(stored.value.targetModel);
  assert.equal(stored.value.manifest.trainingRunCount, 2);
  assert.equal(stored.value.manifest.targetNetwork.syncInterval, 4);
  assert.ok(['promoted', 'candidate-rejected'].includes(stored.value.manifest.status));
  assert.equal(stored.value.manifest.representationTraining.phase, 'head-only');
  assert.equal(
    stored.value.manifest.representationTraining.optimizerState.algorithm,
    'adam-trust-region-v1',
  );
  assert.equal(
    stored.value.manifest.representationTraining.targetCopy.source,
    'checkpoint-target-model',
  );
  const restored = await training.getTaskRecommenderV12Checkpoint(db, 'player-1');
  assert.deepEqual(
    restored.manifest.representationTraining,
    stored.value.manifest.representationTraining,
  );
});

test('training defers below the resolved-decision evidence threshold', async () => {
  const db = new MemoryDb();
  for (const event of makeTrainingEvents(7)) await db.add('taskRecommendations', event);
  const deferred = await training.trainTaskRecommenderV12(db, 'player-1', { maxSteps: 8 });
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.deferralReason, 'insufficient-resolved-decisions');
  assert.equal(deferred.resolvedExamples, 7);
  assert.equal(deferred.trainedExamples, 0);
  assert.equal(deferred.metrics.trainingGate.minimumResolvedDecisions, 8);
  assert.equal(await db.get('appSettings', 'task-recommender-v12-checkpoint:player-1'), null);

  for (const event of makeTrainingEvents(8)) await db.add('taskRecommendations', event);
  const eligible = await training.trainTaskRecommenderV12(db, 'player-1', { maxSteps: 8 });
  assert.equal(eligible.deferred, undefined);
  assert.ok(eligible.checkpoint.manifest.updatedAt);
});

test('energy-sensitive scheduling records a deferral without writing a checkpoint', async () => {
  const db = new MemoryDb();
  for (const event of makeTrainingEvents(8)) await db.add('taskRecommendations', event);
  const deferred = await training.trainTaskRecommenderV12(db, 'player-1', {
    maxSteps: 8,
    energyState: { lowPowerMode: true, thermalState: 'serious' },
  });
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.deferralReason, 'energy-sensitive-scheduling');
  assert.equal(deferred.metrics.energyScheduling.energySensitiveDeferrals, 1);
  assert.equal(await db.get('appSettings', 'task-recommender-v12-checkpoint:player-1'), null);
  assert.ok([...db.records.keys()].some((key) => (
    key.includes('task-recommender-v12-training-deferral:player-1:')
  )));
});

test('invalid persisted checkpoint fails closed to a neutral profile model', async () => {
  const db = new MemoryDb();
  await db.add('appSettings', {
    UUID: 'task-recommender-v12-checkpoint:player-1',
    value: { model: { modelVersion: 999 } },
  });
  const recovered = await training.getTaskRecommenderV12Checkpoint(db, 'player-1');
  assert.equal(recovered.recoveredFromInvalidCheckpoint, true);
  assert.equal(recovered.model.posterior.updateCount, 0);
  assert.equal(recovered.recoveryReason, 'incompatible-model-version');
  assert.equal(recovered.discardedModelVersion, 999);
});

test('model v1 checkpoints cross an explicit relearning boundary', async () => {
  const db = new MemoryDb();
  await db.add('appSettings', {
    UUID: 'task-recommender-v12-checkpoint:player-1',
    value: { model: { modelVersion: 1 } },
  });
  const recovered = await training.getTaskRecommenderV12Checkpoint(db, 'player-1');
  assert.equal(recovered.model.modelVersion, 3);
  assert.equal(recovered.model.posterior.updateCount, 0);
  assert.equal(recovered.recoveryReason, 'incompatible-model-version');
  assert.equal(recovered.discardedModelVersion, 1);
});

test('model v2 checkpoints cross the dual-head relearning boundary', async () => {
  const db = new MemoryDb();
  await db.add('appSettings', {
    UUID: 'task-recommender-v12-checkpoint:player-1',
    value: { model: { modelVersion: 2 } },
  });
  const recovered = await training.getTaskRecommenderV12Checkpoint(db, 'player-1');
  assert.equal(recovered.model.modelVersion, 3);
  assert.equal(recovered.model.posterior.updateCount, 0);
  assert.equal(recovered.model.safetyPosterior.updateCount, 0);
  assert.equal(recovered.recoveryReason, 'incompatible-model-version');
  assert.equal(recovered.discardedModelVersion, 2);
});

test('training sources contain no synthetic production replay or semantic targets', () => {
  for (const forbidden of [
    'fatigue', 'readiness', 'continuation', 'momentum', 'durationFit',
    'synthetic-bootstrap', 'completionBonus', 'skipPenalty',
  ]) {
    assert.doesNotMatch(coreSourceRaw, new RegExp(forbidden));
    assert.doesNotMatch(trainingSourceRaw, new RegExp(forbidden));
  }
  assert.match(trainingSourceRaw, /new Worker\(/);
  assert.match(trainingSourceRaw, /worker\.terminate\(\)/);
  assert.match(workerSource, /trainTaskRecommenderV12Candidate/);
});
