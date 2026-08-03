import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteShadowReadinessCoordinator, {
  SQLITE_SHADOW_PROJECTIONS,
} from './SqliteShadowReadinessCoordinator.js';

test('readiness requires a successful synchronization in the current session', async () => {
  const readiness = new SqliteShadowReadinessCoordinator({ sessionId: 'boot-a' });
  assert.throws(
    () => readiness.assertReady(SQLITE_SHADOW_PROJECTIONS),
    (error) => error.code === 'social-cast-source-not-ready',
  );

  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = readiness.begin('planning', async () => {
    calls += 1;
    await gate;
    return { sourceFingerprint: 'planning-a', runId: 'run-a' };
  });
  const second = readiness.begin('planning', async () => {
    calls += 1;
    return { sourceFingerprint: 'wrong', runId: 'wrong' };
  });
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(readiness.getState('planning').state, 'ready');
  assert.equal(readiness.getState('planning').sourceFingerprint, 'planning-a');

  readiness.reset({ sessionId: 'boot-b' });
  assert.equal(readiness.getState('planning').state, 'uninitialized');
  assert.equal(readiness.getState('planning').sessionId, 'boot-b');
});

test('dirty and failed projections remain observable and block selection', async () => {
  const readiness = new SqliteShadowReadinessCoordinator({ sessionId: 'boot' });
  for (const domain of SQLITE_SHADOW_PROJECTIONS) {
    readiness.markReady(domain, { sourceFingerprint: domain, runId: `run-${domain}` });
  }
  readiness.assertReady(SQLITE_SHADOW_PROJECTIONS);
  readiness.markDirty('matches');
  assert.throws(
    () => readiness.assertReady(SQLITE_SHADOW_PROJECTIONS),
    (error) => error.code === 'social-cast-source-not-ready'
      && error.states.find((state) => state.domain === 'matches')?.state === 'dirty',
  );

  await assert.rejects(
    readiness.begin('matches', async () => {
      throw Object.assign(new Error('match projection failed'), { code: 'forced-import-failure' });
    }),
    /match projection failed/,
  );
  assert.equal(readiness.getState('matches').state, 'failed');
  assert.equal(readiness.getState('matches').error.code, 'forced-import-failure');
});
