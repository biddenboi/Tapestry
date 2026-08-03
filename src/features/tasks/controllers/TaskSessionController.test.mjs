import assert from 'node:assert/strict';
import test from 'node:test';
import TaskSessionController from './TaskSessionController.js';

test('a stable settlement operation ID invokes canonical completion once', async () => {
  let calls = 0;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });
  const controller = new TaskSessionController({
    completeTask: async (command) => {
      calls += 1;
      await completion;
      return { command };
    },
  });
  const first = controller.settle({ operationId: 'session:one', command: { action: 'log' } });
  const retry = controller.settle({ operationId: 'session:one', command: { action: 'done' } });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(first, retry);
  resolveCompletion();
  assert.deepEqual(await retry, { command: { action: 'log' } });
});

test('a rejected settlement remains retryable without admitting concurrent duplicates', async () => {
  let calls = 0;
  const controller = new TaskSessionController({
    completeTask: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      return { ok: true };
    },
  });
  await assert.rejects(controller.settle({ operationId: 'session:retry', command: {} }), /temporary/);
  assert.deepEqual(
    await controller.settle({ operationId: 'session:retry', command: {} }),
    { ok: true },
  );
  assert.equal(calls, 2);
});
