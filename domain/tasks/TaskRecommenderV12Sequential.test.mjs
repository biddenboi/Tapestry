import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./TaskRecommenderV12Sequential.js', import.meta.url), 'utf8');
const sequential = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const DAY_MS = 24 * 60 * 60 * 1000;

function step(index, overrides = {}) {
  return {
    decisionUUID: `decision-${index}`,
    decisionSequence: index,
    occurredAt: new Date(Date.UTC(2026, 0, index, 12)).toISOString(),
    rewardHours: 0,
    qValue: 0,
    behaviorProbability: 0.5,
    targetProbability: 0.5,
    ...overrides,
  };
}

test('continuous-time discount has a versioned thirty-day half-life', () => {
  assert.equal(sequential.TASK_RECOMMENDER_V12_RETURN_SCHEMA_VERSION, 3);
  assert.equal(sequential.taskRecommenderV12ContinuousDiscount(0), 1);
  assert.ok(Math.abs(
    sequential.taskRecommenderV12ContinuousDiscount(30 * DAY_MS) - 0.5,
  ) < 1e-12);
  assert.ok(Math.abs(
    sequential.taskRecommenderV12ContinuousDiscount(60 * DAY_MS) - 0.25,
  ) < 1e-12);
});

test('verified work is discounted from decision time to its actual session timestamp', () => {
  const decisionAt = '2026-01-01T12:00:00.000Z';
  const finishedAt = '2026-01-11T12:00:00.000Z';
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, {
      occurredAt: decisionAt,
      rewardHours: 1,
      rewardAtoms: [{
        rewardAtomSchemaVersion: 1,
        eventUUID: 'finish-1',
        occurredAt: finishedAt,
        rewardHours: 1,
        timingVerified: true,
      }],
      qValue: 0,
    }),
  ], { observationEndAt: finishedAt, finalBootstrapValue: 0 });
  const expected = sequential.taskRecommenderV12ContinuousDiscount(10 * DAY_MS);
  assert.equal(transitions[0].rawRewardHours, 1);
  assert.ok(Math.abs(transitions[0].rewardHours - expected) < 1e-12);
  assert.ok(Math.abs(transitions[0].rewardTimingDiscountHours - (1 - expected)) < 1e-12);
  assert.equal(transitions[0].rewardTimingVerified, true);
  assert.equal(transitions[0].rewardAtoms[0].elapsedMs, 10 * DAY_MS);
  const result = sequential.computeTaskRecommenderV12RetraceTargets(transitions);
  assert.ok(Math.abs(result.targets[0].targetWorkHours - expected) < 1e-12);
  assert.equal(result.targets[0].verifiedWorkHours, 1);
  assert.ok(Math.abs(result.diagnostics.rewardTimingDiscountHours - (1 - expected)) < 1e-12);
});

test('traces cross explicit later observation sessions and report return credit', () => {
  const firstAt = '2026-01-01T12:00:00.000Z';
  const returnedAt = '2026-01-02T12:00:00.000Z';
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { occurredAt: firstAt, observationSessionUUID: 'visit-a' }),
    step(2, {
      occurredAt: returnedAt,
      observationSessionUUID: 'visit-b',
      rewardAtoms: [{ occurredAt: returnedAt, rewardHours: 1, timingVerified: true }],
    }),
  ], { observationEndAt: returnedAt, finalBootstrapValue: 0 });
  assert.equal(transitions[0].crossesObservedReturn, true);
  const result = sequential.computeTaskRecommenderV12RetraceTargets(transitions, { lambda: 1 });
  const expected = sequential.taskRecommenderV12ContinuousDiscount(DAY_MS);
  assert.ok(Math.abs(result.targets[0].targetWorkHours - expected) < 1e-12);
  assert.equal(result.targets[0].crossedObservedReturn, true);
  assert.equal(result.diagnostics.observedReturnBoundaries, 1);
  assert.equal(result.diagnostics.targetsCrossingObservedReturns, 1);
});

test('adaptive traces stop after their coefficient becomes numerically negligible', () => {
  const chain = sequential.buildTaskRecommenderV12DecisionTransitions(
    Array.from({ length: 100 }, (_, index) => step(index + 1, {
      occurredAt: '2026-01-01T12:00:00.000Z',
    })),
    { finalBootstrapValue: 0 },
  );
  const result = sequential.computeTaskRecommenderV12RetraceTargets(chain, {
    lambda: 0.8,
    maxTraceSteps: 64,
    minimumTraceWeight: 1e-4,
  });
  assert.ok(result.targets[0].traceLength < 64);
  assert.equal(result.targets[0].terminationReason, 'weight');
  assert.ok(result.diagnostics.traceWeightTerminations > 0);
});

test('unverified reward timing stops delayed traces at the unverifiable boundary', () => {
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { occurredAt: '2026-01-01T12:00:00.000Z' }),
    step(2, {
      occurredAt: '2026-01-01T12:00:00.000Z',
      rewardHours: 1,
      rewardTimingVerified: false,
    }),
    step(3, { occurredAt: '2026-01-01T12:00:00.000Z', rewardHours: 1 }),
  ], { finalBootstrapValue: 0 });
  const result = sequential.computeTaskRecommenderV12RetraceTargets(transitions, { lambda: 1 });
  assert.equal(result.targets[0].targetWorkHours, 0);
  assert.equal(result.targets[0].terminationReason, 'unverified-reward-timing');
  assert.ok(result.diagnostics.unverifiedTimingTerminations > 0);
});

test('decision transitions cross later returns and right-censor database end', () => {
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { qValue: 0.2 }),
    step(3, { qValue: 0.4 }),
  ], { observationEndAt: new Date(Date.UTC(2026, 0, 10, 12)).toISOString() });
  assert.equal(transitions[0].elapsedMs, 2 * DAY_MS);
  assert.equal(transitions[0].nextDecisionUUID, 'decision-3');
  assert.equal(transitions[1].terminal, false);
  assert.equal(transitions[1].censored, true);
  assert.equal(transitions[1].nextStateValue, 0.4);
  assert.equal(transitions[1].elapsedMs, 7 * DAY_MS);
});

test('Retrace matches an analytical two-step on-policy return', () => {
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { occurredAt: '2026-01-01T12:00:00.000Z', rewardHours: 0.2, qValue: 1 }),
    step(2, { occurredAt: '2026-01-01T12:00:00.000Z', rewardHours: 0.4, qValue: 0.8 }),
  ], { finalBootstrapValue: 0.5 });
  const result = sequential.computeTaskRecommenderV12RetraceTargets(transitions, { lambda: 0.8 });
  assert.ok(Math.abs(result.targets[0].oneStepTargetWorkHours - 1) < 1e-12);
  assert.ok(Math.abs(result.targets[0].targetWorkHours - 1.08) < 1e-12);
  assert.ok(Math.abs(result.targets[1].targetWorkHours - 0.9) < 1e-12);
  assert.equal(result.targets[1].censored, true);
});

test('off-policy coefficients use exact probabilities and clip only the trace ratio', () => {
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { occurredAt: '2026-01-01T12:00:00.000Z', rewardHours: 0.2, qValue: 1 }),
    step(2, {
      occurredAt: '2026-01-01T12:00:00.000Z',
      rewardHours: 0.4,
      qValue: 0.8,
      behaviorProbability: 0.2,
      targetProbability: 0.1,
    }),
  ], { finalBootstrapValue: 0.5 });
  const result = sequential.computeTaskRecommenderV12RetraceTargets(transitions, { lambda: 0.8 });
  assert.equal(transitions[1].importanceRatio, 0.5);
  assert.ok(Math.abs(result.targets[0].targetWorkHours - 1.04) < 1e-12);

  const clipped = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1),
    step(2, { behaviorProbability: 0.2, targetProbability: 0.4 }),
  ]);
  const clippedResult = sequential.computeTaskRecommenderV12RetraceTargets(clipped);
  assert.equal(clipped[1].importanceRatio, 2);
  assert.equal(clippedResult.diagnostics.clippedImportanceRatios, 1);
});

test('censored boundaries bootstrap while trace caps bound work', () => {
  const censored = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { rewardHours: 0.5, qValue: 0.25 }),
  ], { finalBootstrapValue: 0.25 });
  const censoredTarget = sequential.computeTaskRecommenderV12RetraceTargets(censored);
  assert.ok(Math.abs(censoredTarget.targets[0].targetWorkHours - 0.75) < 1e-12);

  const chain = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { occurredAt: '2026-01-01T12:00:00.000Z' }),
    step(2, { occurredAt: '2026-01-01T12:00:00.000Z' }),
    step(3, { occurredAt: '2026-01-01T12:00:00.000Z', rewardHours: 1 }),
  ], { finalBootstrapValue: 0 });
  const capped = sequential.computeTaskRecommenderV12RetraceTargets(chain, {
    lambda: 0.8,
    maxTraceSteps: 2,
  });
  const uncapped = sequential.computeTaskRecommenderV12RetraceTargets(chain, {
    lambda: 0.8,
    maxTraceSteps: 3,
  });
  assert.equal(capped.targets[0].targetWorkHours, 0);
  assert.ok(Math.abs(uncapped.targets[0].targetWorkHours - 0.64) < 1e-12);
  assert.equal(capped.diagnostics.maximumTraceLength, 2);
});

test('missing propensity stops off-policy traces instead of inventing a probability', () => {
  const transitions = sequential.buildTaskRecommenderV12DecisionTransitions([
    step(1, { occurredAt: '2026-01-01T12:00:00.000Z', qValue: 0.2 }),
    step(2, {
      occurredAt: '2026-01-01T12:00:00.000Z',
      rewardHours: 1,
      behaviorProbability: null,
      targetProbability: null,
    }),
  ]);
  const result = sequential.computeTaskRecommenderV12RetraceTargets(transitions);
  assert.equal(result.targets[0].targetWorkHours, 0);
  assert.equal(result.diagnostics.missingPropensities, 1);
  assert.equal(result.targets[0].terminationReason, 'unsupported-propensity-boundary');
  assert.equal(result.diagnostics.unsupportedPropensityTerminations, 2);
});
