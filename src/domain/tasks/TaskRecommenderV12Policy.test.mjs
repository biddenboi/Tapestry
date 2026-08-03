import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mathSource = await readFile(new URL('./TaskRecommenderV12Math.js', import.meta.url), 'utf8');
const mathUrl = `data:text/javascript;base64,${Buffer.from(mathSource).toString('base64')}`;
const encodingSource = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encodingUrl = `data:text/javascript;base64,${Buffer.from(encodingSource).toString('base64')}`;
const encoding = await import(encodingUrl);
const modelSourceRaw = await readFile(new URL('./TaskRecommenderV12Model.js', import.meta.url), 'utf8');
const modelSource = modelSourceRaw.replace("from './TaskRecommenderV12Math.js';", `from '${mathUrl}';`);
const modelUrl = `data:text/javascript;base64,${Buffer.from(modelSource).toString('base64')}`;
const model = await import(modelUrl);
const policySourceRaw = await readFile(new URL('./TaskRecommenderV12Policy.js', import.meta.url), 'utf8');
const policySource = policySourceRaw
  .replace("from './TaskRecommenderV12Encoding.js';", `from '${encodingUrl}';`)
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`)
  .replace("from './TaskRecommenderV12Math.js';", `from '${mathUrl}';`);
const policyUrl = `data:text/javascript;base64,${Buffer.from(policySource).toString('base64')}`;
const policy = await import(policyUrl);

const stateSourceRaw = await readFile(new URL('./TaskRecommenderV12PolicyState.js', import.meta.url), 'utf8');
const stateSource = stateSourceRaw
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { appSetting: 'appSettings' };",
  )
  .replace("from './TaskRecommenderV12Policy.js';", `from '${policyUrl}';`);
const policyState = await import(
  `data:text/javascript;base64,${Buffer.from(stateSource).toString('base64')}`
);

function fixture() {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'policy-fixture' });
  const tasks = [
    { UUID: 'task-a', name: 'Draft chapter', estimatedDuration: 25 },
    { UUID: 'task-b', name: 'Review citations', estimatedDuration: 15 },
    { UUID: 'task-c', name: 'Outline appendix', estimatedDuration: 40 },
  ];
  const actions = encoding.buildTaskRecommenderV12ActionSet(tasks, {
    minDurationSeconds: 300,
    maxDurationSeconds: 1_200,
    durationPointCount: 3,
    durationQuantumSeconds: 60,
  });
  return {
    valueModel,
    actions,
    recurrentState: Array(valueModel.dimensions.state).fill(0),
  };
}

function fitSupportedHeads(valueModel, actions, recurrentState) {
  for (let pass = 0; pass < 8; pass += 1) {
    actions.forEach((action, index) => {
      const encoded = encoding.encodeTaskRecommenderV12Action(action, {
        now: '2026-07-11T12:00:00.000Z',
        source: 'dojo',
      });
      const representation = model.taskRecommenderV12Representation(
        valueModel,
        recurrentState,
        encoded,
      );
      model.updateTaskRecommenderV12Posterior(
        valueModel.posterior,
        representation,
        1 + index / actions.length,
      );
      model.updateTaskRecommenderV12Posterior(
        valueModel.safetyPosterior,
        representation,
        4 + index / actions.length,
      );
    });
  }
}

test('finite posterior votes are exact, deterministic, and calibrated under symmetry', () => {
  const posterior = model.createTaskRecommenderV12BayesianPosterior({ width: 32 });
  const left = Array(32).fill(0);
  const right = Array(32).fill(0);
  left[0] = 1;
  right[1] = 1;
  const candidates = [
    { actionKey: 'left:300', taskUUID: 'left', durationSeconds: 300, representation: left },
    { actionKey: 'right:300', taskUUID: 'right', durationSeconds: 300, representation: right },
  ];
  const first = policy.sampleTaskRecommenderV12PosteriorVotes(posterior, candidates, {
    seed: 'symmetric',
    sampleCount: 1_024,
  });
  const second = policy.sampleTaskRecommenderV12PosteriorVotes(posterior, candidates, {
    seed: 'symmetric',
    sampleCount: 1_024,
  });
  assert.deepEqual(first.votes, second.votes);
  assert.equal(first.votes.reduce((sum, row) => sum + row.count, 0), 1_024);
  assert.equal(first.votes.reduce((sum, row) => sum + row.probability, 0), 1);
  assert.ok(first.votes[0].probability > 0.43 && first.votes[0].probability < 0.57);
});

test('hierarchical support floors protect tasks before durations', () => {
  const support = policy.buildTaskRecommenderV12HierarchicalSupport([
    { actionKey: 'a:300', taskUUID: 'a', durationSeconds: 300, count: 64 },
    { actionKey: 'a:600', taskUUID: 'a', durationSeconds: 600, count: 0 },
    { actionKey: 'b:300', taskUUID: 'b', durationSeconds: 300, count: 0 },
    { actionKey: 'b:600', taskUUID: 'b', durationSeconds: 600, count: 0 },
  ], { taskSupportFloor: 0.1, durationSupportFloor: 0.2 });
  assert.equal(support.tasks.find((row) => row.taskUUID === 'b').probability, 0.1);
  assert.equal(
    support.actions.find((row) => row.actionKey === 'a:600').durationConditionalProbability,
    0.2,
  );
  assert.ok(Math.abs(
    support.actions.filter((row) => row.taskUUID === 'b')
      .reduce((sum, row) => sum + row.explorationProbability, 0) - 0.1,
  ) < 1e-12);
  assert.ok(support.actions.every((row) => row.explorationProbability > 0));
  assert.ok(Math.abs(
    support.actions.reduce((sum, row) => sum + row.explorationProbability, 0) - 1,
  ) < 1e-12);
});

test('cold start is neutral across tasks and cannot create safety debt', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'cold-start' });
  const tasks = Array.from({ length: 20 }, (_, index) => ({
    UUID: `task-${String(index).padStart(2, '0')}`,
    name: `Task ${index}`,
    estimatedDuration: 25,
  }));
  const actions = encoding.buildTaskRecommenderV12ActionSet(tasks);
  const recurrentState = Array(valueModel.dimensions.state).fill(0);
  const first = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'cold-start-first',
    budgetState: { balanceImmediateWorkHours: 0, safetyFraction: 0.1 },
  });
  assert.equal(first.policyDecision.evidence.phase, 'neutral-exploration');
  assert.equal(first.policyDecision.safety.enabled, false);
  assert.equal(first.policyDecision.safety.baselineReferenceHours, 0);
  assert.equal(first.policyDecision.safety.reservedImmediateWorkHours, 0);
  for (const task of tasks) {
    assert.ok(Math.abs(first.distribution
      .filter((row) => row.taskUUID === task.UUID)
      .reduce((sum, row) => sum + row.behaviorProbability, 0) - 0.05) < 1e-12);
  }

  const reserved = policy.reserveTaskRecommenderV12Budget(
    policy.normalizeTaskRecommenderV12BudgetState({
      balanceImmediateWorkHours: 0,
      safetyFraction: 0.1,
    }),
    'cold-decision',
    first.policyDecision,
  );
  const afterSkip = policy.resolveTaskRecommenderV12Budget(reserved, 'cold-decision', 0);
  assert.equal(afterSkip.balanceImmediateWorkHours, 0);
  const second = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'cold-start-second',
    budgetState: afterSkip,
  });
  assert.equal(second.policyDecision.safety.maximumSafeExplorationMixture, 1);
  for (const task of tasks) {
    assert.ok(Math.abs(second.distribution
      .filter((row) => row.taskUUID === task.UUID)
      .reduce((sum, row) => sum + row.behaviorProbability, 0) - 0.05) < 1e-12);
  }

  const champions = new Set(Array.from({ length: 16 }, (_, index) => (
    policy.buildTaskRecommenderV12PolicyDecision({
      model: valueModel,
      recurrentState,
      actions,
      seed: `tie-seed-${index}`,
    }).policyDecision.champion.actionKey
  )));
  assert.ok(champions.size > 1, 'zero-mean champion ties must not resolve lexicographically');
});

test('neutral support is hierarchical across tasks before duration actions', () => {
  const support = policy.buildTaskRecommenderV12NeutralSupport([
    { actionKey: 'a:300', taskUUID: 'a', durationSeconds: 300 },
    { actionKey: 'a:600', taskUUID: 'a', durationSeconds: 600 },
    { actionKey: 'b:300', taskUUID: 'b', durationSeconds: 300 },
  ]);
  assert.equal(support.tasks.find((row) => row.taskUUID === 'a').probability, 0.5);
  assert.equal(support.tasks.find((row) => row.taskUUID === 'b').probability, 0.5);
  assert.equal(support.actions.find((row) => row.actionKey === 'a:300').explorationProbability, 0.25);
  assert.equal(support.actions.find((row) => row.actionKey === 'a:600').explorationProbability, 0.25);
  assert.equal(support.actions.find((row) => row.actionKey === 'b:300').explorationProbability, 0.5);
});

test('posterior refinement adds only quantized points adjacent to learned maxima', () => {
  const snapshot = encoding.createTaskRecommenderV12TaskSnapshot({
    UUID: 'task-a', name: 'Draft', estimatedDuration: 10,
  });
  const refined = policy.refineTaskRecommenderV12DurationSupport([
    { actionKey: 'task-a:300', taskUUID: 'task-a', durationSeconds: 300, durationQuantumSeconds: 60, taskSnapshot: snapshot, mean: 0 },
    { actionKey: 'task-a:600', taskUUID: 'task-a', durationSeconds: 600, durationQuantumSeconds: 60, taskSnapshot: snapshot, mean: 1 },
    { actionKey: 'task-a:1200', taskUUID: 'task-a', durationSeconds: 1200, durationQuantumSeconds: 60, taskSnapshot: snapshot, mean: 0 },
  ]);
  assert.deepEqual(refined.map((action) => action.durationSeconds), [1200, 300, 420, 600, 840]);
  assert.ok(refined.every((action) => action.durationSeconds % 60 === 0));
});

test('policy decisions reproduce exactly and persist joint propensity provenance', () => {
  const { valueModel, actions, recurrentState } = fixture();
  const input = {
    model: valueModel,
    recurrentState,
    actions,
    context: { now: '2026-07-11T12:00:00.000Z', source: 'dojo' },
    seed: 'decision-42',
    budgetState: { balanceImmediateWorkHours: 2 },
    options: { posteriorSampleCount: 64 },
  };
  const first = policy.buildTaskRecommenderV12PolicyDecision(input);
  const second = policy.buildTaskRecommenderV12PolicyDecision(input);
  assert.deepEqual(first.policyDecision, second.policyDecision);
  assert.equal(first.action.actionKey, second.action.actionKey);
  assert.ok(Math.abs(
    first.distribution.reduce((sum, row) => sum + row.behaviorProbability, 0) - 1,
  ) < 1e-12);
  assert.equal(
    first.policyDecision.selected.jointBehaviorProbability,
    first.policyDecision.selected.taskBehaviorProbability
      * first.policyDecision.selected.durationConditionalBehaviorProbability,
  );
  assert.equal(
    first.policyDecision.voteHistogram.reduce((sum, row) => sum + row.votes, 0),
    64,
  );
  assert.ok(first.policyDecision.posterior.fingerprint);
  assert.ok(first.policyDecision.candidateSetFingerprint);
  assert.deepEqual(
    policy.taskRecommenderV12PolicyDecisionPayload(first.policyDecision),
    first.policyDecision,
  );
});

test('maximum-safe exploration spends no more than cumulative conservative capacity', () => {
  const { valueModel, actions, recurrentState } = fixture();
  fitSupportedHeads(valueModel, actions, recurrentState);
  const constrained = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'constrained',
    budgetState: { balanceImmediateWorkHours: 0, safetyFraction: 0.1 },
    options: { requestedExplorationMixture: 1 },
  }).policyDecision.safety;
  assert.ok(constrained.appliedExplorationMixture <= constrained.maximumSafeExplorationMixture);
  assert.ok(
    constrained.appliedExplorationMixture * constrained.conservativeImmediateShortfallHours
      <= constrained.openingAvailableBudgetHours
        + constrained.safetyFraction * constrained.baselineReferenceHours
        + 1e-12,
  );

  const funded = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'funded',
    budgetState: { balanceImmediateWorkHours: 100, safetyFraction: 0.1 },
    options: { requestedExplorationMixture: 1 },
  }).policyDecision.safety;
  assert.equal(funded.appliedExplorationMixture, 1);
});

test('observations without a positive lower bound cannot activate safety debt', () => {
  const { valueModel, actions, recurrentState } = fixture();
  valueModel.posterior.updateCount = 8;
  const result = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'zero-outcome-evidence',
    budgetState: { balanceImmediateWorkHours: 0, safetyFraction: 0.1 },
  });
  assert.equal(result.policyDecision.evidence.phase, 'posterior-exploration');
  assert.equal(result.policyDecision.evidence.posteriorEvidenceSufficient, true);
  assert.equal(result.policyDecision.evidence.baselineEligible, false);
  assert.ok(result.policyDecision.evidence.safetyBaselineLowerConfidenceHours < 0);
  assert.equal(result.policyDecision.safety.enabled, false);
  assert.equal(result.policyDecision.safety.baselineReferenceHours, 0);
  assert.equal(result.policyDecision.safety.reservedImmediateWorkHours, 0);
  assert.equal(result.policyDecision.safety.appliedExplorationMixture, 1);
});

test('logged probabilities calibrate against deterministic seeded selections', () => {
  const { valueModel, actions, recurrentState } = fixture();
  const actionKey = actions[0].actionKey;
  let selected = 0;
  let expected = 0;
  const trials = 320;
  for (let index = 0; index < trials; index += 1) {
    const result = policy.buildTaskRecommenderV12PolicyDecision({
      model: valueModel,
      recurrentState,
      actions,
      seed: `calibration-${index}`,
      budgetState: { balanceImmediateWorkHours: 100 },
      options: { posteriorSampleCount: 16 },
    });
    if (result.action.actionKey === actionKey) selected += 1;
    expected += result.distribution.find((row) => row.actionKey === actionKey).behaviorProbability;
  }
  assert.ok(Math.abs(selected / trials - expected / trials) < 0.07);
});

test('budget reservations and verified outcomes are cumulative and idempotent', () => {
  const { valueModel, actions, recurrentState } = fixture();
  const decision = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'budget',
    budgetState: { balanceImmediateWorkHours: 1, safetyFraction: 0.1 },
  }).policyDecision;
  const initial = policy.normalizeTaskRecommenderV12BudgetState({
    balanceImmediateWorkHours: 1,
    safetyFraction: 0.1,
  });
  const reserved = policy.reserveTaskRecommenderV12Budget(initial, 'decision-budget', decision);
  assert.equal(reserved.pending.length, 1);
  assert.equal(
    policy.reserveTaskRecommenderV12Budget(reserved, 'decision-budget', decision).pending.length,
    1,
  );
  const resolved = policy.resolveTaskRecommenderV12Budget(reserved, 'decision-budget', 1_800);
  assert.equal(resolved.pending.length, 0);
  assert.equal(resolved.cumulativeObservedImmediateWorkHours, 0.5);
  assert.equal(resolved.resolvedDecisionCount, 1);
  assert.equal(
    policy.resolveTaskRecommenderV12Budget(
      resolved,
      'decision-budget',
      1_800,
    ).balanceImmediateWorkHours,
    resolved.balanceImmediateWorkHours,
  );
});

class MemoryDb {
  records = new Map();

  async get(store, UUID) {
    return this.records.get(`${store}:${UUID}`) || null;
  }

  async add(store, record) {
    this.records.set(`${store}:${record.UUID}`, record);
    return record;
  }
}

test('policy state serializes concurrent receipts with the exact RNG and propensity record', async () => {
  const db = new MemoryDb();
  const { valueModel, actions, recurrentState } = fixture();
  const decision = policy.buildTaskRecommenderV12PolicyDecision({
    model: valueModel,
    recurrentState,
    actions,
    seed: 'persistent-policy',
    budgetState: { balanceImmediateWorkHours: 1 },
  }).policyDecision;
  await Promise.all([
    policyState.reserveTaskRecommenderV12PolicyDecision(
      db, 'player-1', 'decision-1', decision,
    ),
    policyState.reserveTaskRecommenderV12PolicyDecision(
      db, 'player-1', 'decision-2', decision,
    ),
  ]);
  let stored = await policyState.getTaskRecommenderV12PolicyState(db, 'player-1');
  assert.equal(stored.state.decisionReceipts.length, 2);
  assert.equal(stored.state.budget.pending.length, 2);
  assert.equal(
    stored.state.decisionReceipts[0].policyDecision.rngRecipe.seed,
    'persistent-policy',
  );
  assert.equal(
    stored.state.decisionReceipts[0].policyDecision.selected.jointBehaviorProbability,
    decision.selected.jointBehaviorProbability,
  );
  await policyState.resolveTaskRecommenderV12PolicyDecision(
    db, 'player-1', 'decision-1', 900,
  );
  stored = await policyState.getTaskRecommenderV12PolicyState(db, 'player-1');
  assert.equal(stored.state.budget.pending.length, 1);
  assert.equal(stored.state.budget.resolvedDecisionCount, 1);
  assert.equal(stored.state.decisionReceipts[0].status, 'resolved');
  await policyState.invalidateTaskRecommenderV12PolicyDecision(
    db,
    'player-1',
    'decision-2',
  );
  stored = await policyState.getTaskRecommenderV12PolicyState(db, 'player-1');
  assert.equal(stored.state.budget.pending.length, 0);
  assert.equal(stored.state.budget.resolvedDecisionCount, 1);
  assert.equal(stored.state.decisionReceipts[1].status, 'invalidated');
});

test('policy source does not author task meaning or fixed behavior schedules', () => {
  for (const forbidden of [
    'fatigue', 'readiness', 'continuation', 'momentum', 'urgent', 'easy-task',
    'morning-routine', 'deadline-boost', 'durationFit',
  ]) {
    assert.doesNotMatch(policySourceRaw, new RegExp(forbidden, 'i'));
  }
});
