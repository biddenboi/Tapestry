import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteWorkerClient from './SqliteWorkerClient.js';
import { SQLITE_ERROR_CODES } from './sqliteErrors.js';

class FakeWorker {
  constructor(handler = null) {
    this.handler = handler;
    this.messages = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  postMessage(message) {
    this.messages.push(message);
    this.handler?.(message, this);
  }

  respond(requestId, result = null, error = null) {
    queueMicrotask(() => this.onmessage?.({
      data: { type: 'response', requestId, result, error },
    }));
  }

  terminate() { this.terminated = true; }
}

test('typed worker client correlates responses by request ID', async (t) => {
  const worker = new FakeWorker((message, target) => {
    target.respond(message.requestId, { command: message.command });
  });
  const client = new SqliteWorkerClient({ workerFactory: () => worker, requestIdPrefix: 'test' });
  t.after(() => client.terminate());
  const [left, right] = await Promise.all([
    client.query({ sql: 'SELECT 1', result: 'value' }),
    client.status(),
  ]);
  assert.equal(left.command, 'query');
  assert.equal(right.command, 'status');
  assert.notEqual(worker.messages[0].requestId, worker.messages[1].requestId);
});


test('progress messages reach the active caller without settling it', async (t) => {
  const worker = new FakeWorker((message, target) => {
    queueMicrotask(() => target.onmessage?.({
      data: { type: 'progress', requestId: message.requestId, progress: { stage: 'before-commit' } },
    }));
    target.respond(message.requestId, { complete: true });
  });
  const client = new SqliteWorkerClient({ workerFactory: () => worker });
  t.after(() => client.terminate());
  const progress = [];
  const result = await client.status({ onProgress: (event) => progress.push(event) });
  assert.deepEqual(progress, [{ stage: 'before-commit' }]);
  assert.deepEqual(result, { complete: true });
});

test('request timeout detaches the caller and ignores a late response', async (t) => {
  const worker = new FakeWorker();
  const client = new SqliteWorkerClient({ workerFactory: () => worker, requestTimeoutMs: 10 });
  t.after(() => client.terminate());
  const pending = client.status({ timeoutMs: 10 });
  await assert.rejects(pending, (error) => error.code === SQLITE_ERROR_CODES.requestTimeout);
  const original = worker.messages.find(({ command }) => command === 'status');
  worker.respond(original.requestId, { late: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(client.pending.size, 0);
  assert.ok(worker.messages.some(({ command }) => command === 'cancel'));
});

test('aborted caller is detached without terminating the worker', async (t) => {
  const worker = new FakeWorker();
  const client = new SqliteWorkerClient({ workerFactory: () => worker });
  t.after(() => client.terminate());
  const controller = new AbortController();
  const pending = client.status({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === SQLITE_ERROR_CODES.aborted);
  assert.equal(worker.terminated, false);
  assert.equal(client.pending.size, 0);
});

test('worker termination rejects every pending caller', async () => {
  const worker = new FakeWorker();
  const client = new SqliteWorkerClient({ workerFactory: () => worker });
  const pending = client.status({ timeoutMs: 1000 });
  client.terminate();
  await assert.rejects(pending, (error) => error.code === SQLITE_ERROR_CODES.workerTerminated);
  assert.equal(worker.terminated, true);
});

test('remote typed errors retain code, retryability, and details', async (t) => {
  const worker = new FakeWorker((message, target) => {
    target.respond(message.requestId, null, {
      name: 'SqliteRuntimeError',
      message: 'busy',
      code: SQLITE_ERROR_CODES.busy,
      retryable: true,
      details: { attempt: 1 },
    });
  });
  const client = new SqliteWorkerClient({ workerFactory: () => worker });
  t.after(() => client.terminate());
  await assert.rejects(client.status(), (error) => (
    error.code === SQLITE_ERROR_CODES.busy
    && error.retryable === true
    && error.details.attempt === 1
  ));
});
