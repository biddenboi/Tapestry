import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BackgroundJobScheduler,
  scheduleBackgroundCallback,
} from './BackgroundJobScheduler.js';

test('default background scheduling does not execute in the enqueue call stack', async () => {
  const order = [];
  const scheduler = new BackgroundJobScheduler({ concurrency: 1 });
  scheduler.register('deferred', async () => { order.push('job'); });
  const handle = scheduler.enqueue({ type: 'deferred' });
  order.push('caller');
  assert.deepEqual(order, ['caller']);
  await handle.promise;
  assert.deepEqual(order, ['caller', 'job']);
  assert.ok(handle.snapshot().durationMs >= 0);
  scheduler.dispose();
});

test('background schedule prefers scheduler.postTask and remains cancellable', async () => {
  const original = globalThis.scheduler;
  let options = null;
  globalThis.scheduler = {
    postTask(callback, received) {
      options = received;
      return Promise.resolve().then(callback);
    },
  };
  try {
    let called = false;
    scheduleBackgroundCallback(() => { called = true; });
    assert.equal(called, false);
    await Promise.resolve();
    assert.equal(called, true);
    assert.equal(options.priority, 'background');
    assert.ok(options.signal instanceof AbortSignal);
  } finally {
    if (original === undefined) delete globalThis.scheduler;
    else globalThis.scheduler = original;
  }
});
