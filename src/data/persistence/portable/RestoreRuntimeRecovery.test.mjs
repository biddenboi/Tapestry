import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareRestoreRuntime } from './RestoreRuntimeRecovery.js';

test('a healthy startup does not reopen SQLite for restore', async () => {
  let opens = 0;
  const result = await prepareRestoreRuntime({
    ready: Promise.resolve(),
    adapter: { open: async () => { opens += 1; } },
  });

  assert.equal(result.recoveredStartup, false);
  assert.equal(opens, 0);
});

test('a failed integrity startup is reopened without repeating the failed check', async () => {
  const startupError = Object.assign(new Error('SQLite integrity checks failed.'), {
    code: 'SQLITE_INTEGRITY_FAILED',
  });
  let receivedOptions;
  const result = await prepareRestoreRuntime({
    ready: Promise.reject(startupError),
    adapter: {
      open: async (options) => {
        receivedOptions = options;
        return { initialization: { initialized: true } };
      },
    },
  });

  assert.equal(result.recoveredStartup, true);
  assert.equal(result.startupError, startupError);
  assert.deepEqual(receivedOptions, {
    mode: 'persistent',
    migrate: false,
    runUncleanIntegrityCheck: false,
    writerLeaseWaitMs: 8_000,
    writerLeasePollMs: 120,
  });
});

test('restore recovery explains when another tab owns SQLite', async () => {
  await assert.rejects(
    prepareRestoreRuntime({
      ready: Promise.reject(new Error('startup failed')),
      adapter: { open: async () => ({ initialization: { initialized: false } }) },
    }),
    /open in another tab/i,
  );
});
