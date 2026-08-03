import SqliteRuntime from './SqliteRuntime.js';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import SqliteWriterLease from './SqliteWriterLease.js';
import { serializeSqliteError } from './sqliteErrors.js';
import { SQLITE_WORKER_COMMANDS } from './sqliteProtocol.js';

// The package's internal import.meta URL is rewritten correctly for production,
// but during Vite development it points at the optimized dependency directory.
// Hand the runtime the explicit asset URL so local/browser verification loads
// Wasm bytes rather than the dev server's HTML fallback.
globalThis.__TAPESTRY_SQLITE_WASM_URL__ = sqliteWasmUrl;

const runtime = new SqliteRuntime();
const writerLease = new SqliteWriterLease();
const BUILD_ALLOWS_TEST_HOOKS = import.meta.env?.DEV === true;
let testHooksEnabled = false;
const canceledRequests = new Set();
let requestQueue = Promise.resolve();

const postProgress = (requestId, progress) => {
  self.postMessage({ type: 'progress', requestId, progress });
};

const postReply = (requestId, result = null, error = null) => {
  if (canceledRequests.delete(requestId)) return;
  self.postMessage({
    type: 'response',
    requestId,
    result,
    error: error ? serializeSqliteError(error) : null,
  });
};

async function initialize(payload = {}) {
  const { enableTestHooks = false, ...runtimeOptions } = payload;
  testHooksEnabled = BUILD_ALLOWS_TEST_HOOKS && enableTestHooks === true;
  const mode = runtimeOptions.mode || 'persistent';
  const lease = await writerLease.acquire({
    required: mode === 'persistent' && runtimeOptions.writerLease !== false,
    ifAvailable: true,
  });
  if (!lease.acquired) {
    return {
      initialized: false,
      role: 'recovery_readonly',
      reason: 'writer-lease-unavailable',
      lease,
    };
  }
  try {
    return {
      ...(await runtime.initialize({
        ...runtimeOptions,
        mode,
        role: 'writer',
      })),
      lease,
    };
  } catch (error) {
    await writerLease.release();
    throw error;
  }
}

async function close(payload = {}) {
  const result = await runtime.close({ markClean: payload.markClean !== false });
  await writerLease.release();
  return result;
}

const handlers = Object.freeze({
  [SQLITE_WORKER_COMMANDS.initialize]: initialize,
  [SQLITE_WORKER_COMMANDS.applyMigrations]: (payload) => runtime.applyMigrations(
    payload.migrations,
    payload.options,
  ),
  [SQLITE_WORKER_COMMANDS.executeAtomic]: (payload, { requestId }) => {
    const pauseMs = testHooksEnabled
      ? Math.max(0, Math.min(5_000, Number(payload.testPauseBeforeCommitMs) || 0))
      : 0;
    return runtime.executeAtomic(payload.command, {
      beforeCommit: pauseMs > 0
        ? () => {
          postProgress(requestId, { stage: 'before-commit', testHook: true });
          const deadline = performance.now() + pauseMs;
          while (performance.now() < deadline) {
            // Test-only deterministic crash window. The worker is terminated externally.
          }
        }
        : null,
    });
  },
  [SQLITE_WORKER_COMMANDS.query]: (payload) => runtime.query(payload.statement),
  [SQLITE_WORKER_COMMANDS.integrityCheck]: (payload) => runtime.integrityCheck(payload),
  [SQLITE_WORKER_COMMANDS.exportSnapshot]: () => runtime.exportSnapshot(),
  [SQLITE_WORKER_COMMANDS.verifySnapshot]: (payload) => runtime.verifySnapshot(payload.snapshot),
  [SQLITE_WORKER_COMMANDS.stageSnapshot]: (payload) => runtime.stageSnapshot(payload.snapshot, payload.options),
  [SQLITE_WORKER_COMMANDS.restoreSnapshot]: (payload) => runtime.restoreSnapshot(payload.snapshot),
  [SQLITE_WORKER_COMMANDS.status]: () => runtime.status(),
  [SQLITE_WORKER_COMMANDS.close]: close,
  [SQLITE_WORKER_COMMANDS.testDelay]: async (payload) => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(payload?.milliseconds) || 0)));
    return { delayed: true };
  },
});

async function handleRequest(message) {
  const { requestId, command, payload = {} } = message || {};
  if (!requestId) return;
  if (command === SQLITE_WORKER_COMMANDS.cancel) {
    canceledRequests.add(payload.requestId);
    setTimeout(() => canceledRequests.delete(payload.requestId), 60_000);
    postReply(requestId, { canceled: true, requestId: payload.requestId });
    return;
  }
  try {
    const handler = handlers[command];
    if (!handler) throw new Error(`Unknown SQLite worker command: ${command}`);
    postReply(requestId, await handler(payload, { requestId }));
  } catch (error) {
    postReply(requestId, null, error);
  }
}

self.onmessage = ({ data }) => {
  requestQueue = requestQueue
    .then(() => handleRequest(data))
    .catch((error) => {
      postReply(data?.requestId, null, error);
    });
};
