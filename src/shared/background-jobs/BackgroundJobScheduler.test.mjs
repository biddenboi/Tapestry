import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKGROUND_JOB_PRIORITY,
  BackgroundJobScheduler,
} from './BackgroundJobScheduler.js';

const immediateSchedule = (callback) => {
  queueMicrotask(callback);
  return () => undefined;
};

test('scheduler respects priority, deduplication, and concurrency limits', async () => {
  const order = [];
  let running = 0;
  let maxRunning = 0;
  const scheduler = new BackgroundJobScheduler({ concurrency: 1, schedule: immediateSchedule });
  scheduler.register('work', async (payload) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    order.push(payload.name);
    await Promise.resolve();
    running -= 1;
    return payload.name;
  });

  const low = scheduler.enqueue({ type: 'work', payload: { name: 'low' }, priority: BACKGROUND_JOB_PRIORITY.low, dedupeKey: 'low' });
  const high = scheduler.enqueue({ type: 'work', payload: { name: 'high' }, priority: BACKGROUND_JOB_PRIORITY.high, dedupeKey: 'high' });
  const duplicate = scheduler.enqueue({ type: 'work', payload: { name: 'ignored' }, dedupeKey: 'high' });

  assert.equal(duplicate.id, high.id);
  assert.deepEqual(await Promise.all([low.promise, high.promise]), ['low', 'high']);
  assert.deepEqual(order, ['high', 'low']);
  assert.equal(maxRunning, 1);
  scheduler.dispose();
});

test('scheduler retries bounded failures and supports cancellation', async () => {
  let attempts = 0;
  const scheduler = new BackgroundJobScheduler({ concurrency: 1, retryBaseMs: 1, schedule: immediateSchedule });
  scheduler.register('retry', async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('retry me');
    return 'ok';
  }, { maxAttempts: 2 });
  scheduler.register('blocked', async (_payload, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 50);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('cancelled');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  });

  const retry = scheduler.enqueue({ type: 'retry' });
  assert.equal(await retry.promise, 'ok');
  assert.equal(attempts, 2);

  const blocked = scheduler.enqueue({ type: 'blocked', dedupeKey: 'blocked' });
  blocked.cancel();
  await assert.rejects(blocked.promise, /cancel/i);
  assert.equal(blocked.snapshot().state, 'cancelled');
  scheduler.dispose();
});
