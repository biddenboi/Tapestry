import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOCIAL_WORLD_PERFORMANCE_BUDGETS,
  SOCIAL_WORLD_PERFORMANCE_OPERATION,
  evaluateSocialWorldPerformance,
  measureSocialWorldOperation,
} from './SocialWorldPerformance.js';

test('batch 16 defines concrete p50/p95 and complexity bounds for every rollout path', () => {
  assert.deepEqual(
    Object.keys(SOCIAL_WORLD_PERFORMANCE_BUDGETS).sort(),
    Object.values(SOCIAL_WORLD_PERFORMANCE_OPERATION).sort(),
  );
  for (const budget of Object.values(SOCIAL_WORLD_PERFORMANCE_BUDGETS)) {
    assert.equal(budget.p50Ms <= budget.p95Ms, true);
    assert.equal(Object.keys(budget).some((key) => key.startsWith('max') || key.endsWith('Limit') || key.endsWith('Radius') || key.endsWith('Count')), true);
  }
});

test('instrumentation emits successful and failed samples without changing results', async () => {
  const samples = [];
  let tick = 10;
  const value = await measureSocialWorldOperation('scene-query', async () => 'scene', {
    now: () => (tick += 5), onSample: (sample) => samples.push(sample),
  });
  assert.equal(value, 'scene');
  assert.equal(samples[0].durationMs, 5);
  assert.equal(samples[0].status, 'ok');

  await assert.rejects(measureSocialWorldOperation('dynamic-cast', async () => {
    throw new Error('failed');
  }, { now: () => (tick += 5), onSample: (sample) => samples.push(sample) }));
  assert.equal(samples[1].status, 'error');
  assert.equal(evaluateSocialWorldPerformance('scene-query', [30, 40, 80]).passes, true);
  assert.equal(evaluateSocialWorldPerformance('scene-query', [30, 40, 101]).passes, false);
});
