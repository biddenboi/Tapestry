import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const replaceImport = (source, specifier, url) => source.replace(
  `from '${specifier}';`,
  `from '${url}';`,
);

const mathUrl = dataUrl(await readFile(
  new URL('./TaskRecommenderV12Math.js', import.meta.url),
  'utf8',
));
const modelUrl = dataUrl(replaceImport(
  await readFile(new URL('./TaskRecommenderV12Model.js', import.meta.url), 'utf8'),
  './TaskRecommenderV12Math.js',
  mathUrl,
));
const model = await import(modelUrl);
let registrySource = await readFile(
  new URL('./TaskRecommenderV12PolicyRegistry.js', import.meta.url),
  'utf8',
);
registrySource = registrySource
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings' };")
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`);
const registryUrl = dataUrl(registrySource);
const registry = await import(registryUrl);
const protocolUrl = dataUrl(await readFile(
  new URL('./TaskRecommenderProtocol.js', import.meta.url),
  'utf8',
));
const protocol = await import(protocolUrl);
let evidenceSource = await readFile(
  new URL('./TaskRecommenderV12Evidence.js', import.meta.url),
  'utf8',
);
evidenceSource = evidenceSource
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`)
  .replace("from './TaskRecommenderV12PolicyRegistry.js';", `from '${registryUrl}';`);
const evidence = await import(dataUrl(evidenceSource));

class MemoryDb {
  records = new Map();
  commits = [];
  key(store, UUID) { return `${store}:${UUID}`; }
  async get(store, UUID) { return this.records.get(this.key(store, UUID)) || null; }
  async add(store, record) {
    this.records.set(this.key(store, record.UUID), structuredClone(record));
    return record;
  }
  async getPlayerStore(store, parent) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, record]) => structuredClone(record))
      .filter((record) => String(record.parent) === String(parent));
  }
  async commitAtomicMutation(mutation) {
    this.commits.push(structuredClone(mutation));
    for (const put of mutation.puts || []) await this.add(put.store, put.record);
    return { changed: true };
  }
}

function checkpoint(seed = 'current') {
  const value = model.createTaskRecommenderV12Model({ seed });
  return { model: value, targetModel: structuredClone(value), manifest: { trainingRunCount: 1 } };
}

test('registry keeps neutral, current, candidate, and ablation manifests outside serving state', async () => {
  const db = new MemoryDb();
  const currentCheckpoint = checkpoint('registry-current');
  const initialized = await registry.ensureTaskRecommenderV12PolicyRegistry(
    db,
    'player-1',
    currentCheckpoint,
    { now: '2026-07-01T00:00:00.000Z' },
  );
  assert.equal(initialized.champion.role, 'current');
  assert.equal(initialized.champion.runtime, 'v12');
  assert.equal(initialized.champion.legacyPlanningSemantics, false);
  assert.equal(initialized.neutral.role, 'neutral');

  const candidate = await registry.registerTaskRecommenderV12PolicyCandidate(
    db,
    'player-1',
    checkpoint('registry-candidate'),
    { parentCheckpoint: currentCheckpoint, trainingEvidence: { trainingWallTimeMs: 25 } },
  );
  const ablation = await registry.registerTaskRecommenderV12PolicyCandidate(
    db,
    'player-1',
    currentCheckpoint,
    { role: 'ablation', policyOptions: { disableDurationRefinement: true } },
  );
  assert.equal(candidate.role, 'candidate');
  assert.equal(ablation.role, 'ablation');

  const selected = await registry.resolveTaskRecommenderV12ServingPolicy(
    db,
    'player-1',
    checkpoint('ignored-later-training'),
    { assignmentKey: 'decision-1', occurredAt: '2026-07-02T00:00:00.000Z' },
  );
  assert.equal(selected.policyManifest.policyUUID, initialized.champion.policyUUID);
  assert.notEqual(selected.policyManifest.policyUUID, candidate.policyUUID);
});

test('micro-randomized and switchback assignments are deterministic and durably exact', async () => {
  const db = new MemoryDb();
  const currentCheckpoint = checkpoint('assignment-current');
  const initialized = await registry.ensureTaskRecommenderV12PolicyRegistry(
    db,
    'player-1',
    currentCheckpoint,
  );
  const candidate = await registry.registerTaskRecommenderV12PolicyCandidate(
    db,
    'player-1',
    checkpoint('assignment-candidate'),
    { parentCheckpoint: currentCheckpoint },
  );
  const arms = [
    { armUUID: 'current', policyUUID: initialized.champion.policyUUID, weight: 3 },
    { armUUID: 'candidate', policyUUID: candidate.policyUUID, weight: 1 },
  ];
  const micro = await registry.saveTaskRecommenderV12Experiment(db, {
    playerUUID: 'player-1', experimentUUID: 'micro-1', assignmentMethod: 'micro-randomized', arms,
    startedAt: '2026-07-01T00:00:00.000Z',
  });
  const first = registry.assignTaskRecommenderV12Experiment(micro, {
    assignmentKey: 'decision-7', occurredAt: '2026-07-02T00:00:00.000Z',
  });
  const second = registry.assignTaskRecommenderV12Experiment(micro, {
    assignmentKey: 'decision-7', occurredAt: '2026-07-02T00:00:00.000Z',
  });
  assert.deepEqual(first, second);
  assert.equal(first.support.find((arm) => arm.armUUID === 'candidate').probability, 0.25);
  const served = await registry.resolveTaskRecommenderV12ServingPolicy(
    db,
    'player-1',
    currentCheckpoint,
    { assignmentKey: 'decision-7', occurredAt: '2026-07-02T00:00:00.000Z' },
  );
  assert.equal(served.assignment.assignmentProbability, first.assignmentProbability);
  assert.ok([...db.records.keys()].some((key) => key.includes('task-recommender-v12-assignment:')));

  const switchback = await registry.saveTaskRecommenderV12Experiment(db, {
    playerUUID: 'player-1', experimentUUID: 'switch-1', assignmentMethod: 'switchback', arms,
    switchbackIntervalMs: 60 * 60 * 1000, startedAt: '2026-07-01T00:00:00.000Z',
  });
  const sameBlockA = registry.assignTaskRecommenderV12Experiment(switchback, {
    assignmentKey: 'ignored-a', occurredAt: '2026-07-01T02:05:00.000Z',
  });
  const sameBlockB = registry.assignTaskRecommenderV12Experiment(switchback, {
    assignmentKey: 'ignored-b', occurredAt: '2026-07-01T02:55:00.000Z',
  });
  assert.equal(sameBlockA.assignmentKey, sameBlockB.assignmentKey);
  assert.equal(sameBlockA.policyUUID, sameBlockB.policyUUID);
  assert.equal(sameBlockA.assignedAt, '2026-07-01T02:00:00.000Z');
});

function controlledEvents(policyUUID, role, rewards, offsetDays = 0) {
  const events = [];
  let sequence = offsetDays * 100 + 1;
  rewards.forEach((rewardHours, index) => {
    const decisionUUID = `${role}-${index}`;
    const occurredAt = new Date(Date.UTC(2026, 6, 1 + offsetDays + index, 12)).toISOString();
    const base = {
      playerUUID: 'player-1', decisionUUID, taskUUID: `task-${role}`, source: 'dojo',
    };
    events.push(protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
      eventKey: 'created', sequence: sequence++, occurredAt,
      payload: {
        taskSnapshot: { UUID: `task-${role}` },
        observationSessionUUID: `${role}-visit-${index}`,
        policyAssignment: {
          runtime: 'v12', experimentUUID: 'controlled-1', assignmentMethod: 'micro-randomized',
          policyUUID, policyRole: role, assignmentProbability: 0.5, checkpointBytes: 1000,
        },
        policyDecision: { selected: { predictedImmediateWorkHours: rewardHours } },
        deviceEvidence: { scoringMs: 10 + index, totalMs: 15 + index },
      },
    }));
    events.push(protocol.createTaskRecommenderProtocolEvent({
      ...base,
      type: protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished,
      eventKey: 'finished', sequence: sequence++,
      occurredAt: new Date(new Date(occurredAt).getTime() + 60 * 60 * 1000).toISOString(),
      payload: {
        productiveSeconds: rewardHours * 3600,
        sessionFinishedAt: new Date(new Date(occurredAt).getTime() + 60 * 60 * 1000).toISOString(),
      },
    }));
  });
  return events;
}

test('policy evidence gates discounted verified work and atomically promotes with immediate rollback', async () => {
  const db = new MemoryDb();
  const currentCheckpoint = checkpoint('promotion-current');
  const initialized = await registry.ensureTaskRecommenderV12PolicyRegistry(
    db,
    'player-1',
    currentCheckpoint,
  );
  const candidate = await registry.registerTaskRecommenderV12PolicyCandidate(
    db,
    'player-1',
    checkpoint('promotion-candidate'),
    { parentCheckpoint: currentCheckpoint },
  );
  const events = [
    ...controlledEvents(initialized.champion.policyUUID, 'current', [0.4, 0.4, 0.4, 0.4]),
    ...controlledEvents(candidate.policyUUID, 'candidate', [0.5, 0.5, 0.5, 0.5], 10),
  ];
  const report = evidence.buildTaskRecommenderV12EvidenceReport(events, {
    generatedAt: '2026-07-20T00:00:00.000Z',
    trainingEvidenceByPolicy: {
      [candidate.policyUUID]: {
        checkpointBytes: 1000, trainingWallTimeMs: 100,
        energySensitiveDeferrals: 2, energyPolicyViolations: 0,
      },
    },
  });
  const candidateMetric = report.policyMetrics[candidate.policyUUID];
  assert.equal(candidateMetric.prequentialCalibration.meanAbsoluteErrorHours, 0);
  assert.equal(candidateMetric.assignmentSupport.effectiveSampleSize, 4);
  assert.equal(candidateMetric.activeDays, 4);
  assert.equal(candidateMetric.returnIntervals.count, 3);
  assert.equal(candidateMetric.device.energySensitiveDeferrals, 2);

  const decision = evidence.evaluateTaskRecommenderV12Promotion(
    report,
    candidate.policyUUID,
    initialized.champion.policyUUID,
    {
      minimumResolvedDecisionsPerArm: 4,
      minimumEffectiveSampleSizePerArm: 4,
      minimumActiveDays: 4,
      minimumReturnIntervals: 3,
      minimumUpliftHours: 0.05,
    },
  );
  assert.equal(decision.eligible, true);
  assert.equal(decision.effectiveness.criterion, 'uplift');

  const slowReport = structuredClone(report);
  slowReport.policyMetrics[candidate.policyUUID].device.warmScoringP95Ms = 150;
  const slowDecision = evidence.evaluateTaskRecommenderV12Promotion(
    slowReport,
    candidate.policyUUID,
    initialized.champion.policyUUID,
    {
      minimumResolvedDecisionsPerArm: 4,
      minimumEffectiveSampleSizePerArm: 4,
      minimumActiveDays: 4,
      minimumReturnIntervals: 3,
    },
  );
  assert.equal(slowDecision.eligible, false);
  assert.ok(slowDecision.reasons.includes('candidate-latency-budget-exceeded'));

  await assert.rejects(
    registry.promoteTaskRecommenderV12Champion(
      db,
      'player-1',
      candidate.policyUUID,
      { ...decision, championPolicyUUID: 'stale-champion' },
    ),
    /active v12 champion/,
  );

  const promoted = await registry.promoteTaskRecommenderV12Champion(
    db,
    'player-1',
    candidate.policyUUID,
    decision,
  );
  assert.equal(promoted.pointer.championPolicyUUID, candidate.policyUUID);
  assert.match(db.commits.at(-1).label, /atomic-champion-promotion/);
  const rolledBack = await registry.rollbackTaskRecommenderV12Champion(db, 'player-1');
  assert.equal(rolledBack.pointer.championPolicyUUID, initialized.champion.policyUUID);
  assert.match(db.commits.at(-1).label, /immediate-champion-rollback/);
});
