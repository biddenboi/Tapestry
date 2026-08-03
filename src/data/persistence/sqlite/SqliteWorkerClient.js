import {
  SQLITE_ERROR_CODES,
  SqliteRuntimeError,
  hydrateSqliteError,
} from './sqliteErrors.js';
import { SQLITE_WORKER_COMMANDS } from './sqliteProtocol.js';

function createAbortError(message = 'SQLite request was aborted.') {
  const error = new SqliteRuntimeError(message, {
    code: SQLITE_ERROR_CODES.aborted,
  });
  error.name = 'AbortError';
  return error;
}

export function createDefaultSqliteWorker() {
  // Keep the URL construction directly inside Worker(). Vite recognizes this
  // exact static shape and emits a real module-worker asset with its imports;
  // hoisting the URL causes it to become a data: URL whose relative imports
  // cannot resolve in the standalone verification build.
  return new Worker(new URL('./sqlite.worker.js', import.meta.url), {
    type: 'module',
    name: 'tapestry-sqlite-runtime',
  });
}

export class SqliteWorkerClient {
  constructor({
    workerFactory = createDefaultSqliteWorker,
    requestTimeoutMs = 10_000,
    requestIdPrefix = `sqlite-${Math.random().toString(36).slice(2)}`,
  } = {}) {
    this.workerFactory = workerFactory;
    this.requestTimeoutMs = requestTimeoutMs;
    this.requestIdPrefix = requestIdPrefix;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.worker = null;
    this.closed = false;
    this.failed = null;
  }

  _ensureWorker() {
    if (this.closed) {
      throw new SqliteRuntimeError('SQLite worker client is closed.', {
        code: SQLITE_ERROR_CODES.workerTerminated,
      });
    }
    if (this.failed) throw this.failed;
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    if (!worker?.postMessage) {
      throw new SqliteRuntimeError('SQLite worker factory did not return a Worker-compatible object.', {
        code: SQLITE_ERROR_CODES.unavailable,
      });
    }
    this.worker = worker;
    worker.onmessage = (event) => this._handleMessage(event?.data);
    worker.onerror = (event) => this._failWorker(new SqliteRuntimeError(
      event?.message || 'SQLite worker failed.',
      { code: SQLITE_ERROR_CODES.workerFailure, details: { event } },
    ));
    worker.onmessageerror = () => this._failWorker(new SqliteRuntimeError(
      'SQLite worker returned an unreadable message.',
      { code: SQLITE_ERROR_CODES.workerFailure },
    ));
    return worker;
  }

  _handleMessage(message) {
    const pending = this.pending.get(message?.requestId);
    if (!pending) return;
    if (message?.type === 'progress') {
      pending.onProgress?.(message.progress);
      return;
    }
    if (message?.type !== 'response') return;
    this.pending.delete(message.requestId);
    pending.cleanup();
    if (message.error) pending.reject(hydrateSqliteError(message.error));
    else pending.resolve(message.result);
  }

  _failWorker(error) {
    this.failed = error;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }

  call(command, payload = {}, {
    timeoutMs = this.requestTimeoutMs,
    signal = null,
    onProgress = null,
  } = {}) {
    if (signal?.aborted) return Promise.reject(createAbortError());
    let worker;
    try {
      worker = this._ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = `${this.requestIdPrefix}-${this.nextRequestId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.cleanup();
        reject(new SqliteRuntimeError(`SQLite request timed out: ${command}`, {
          code: SQLITE_ERROR_CODES.requestTimeout,
          retryable: command === SQLITE_WORKER_COMMANDS.query,
          details: { requestId, command, timeoutMs },
        }));
        try {
          worker.postMessage({
            requestId: `${requestId}-cancel`,
            command: SQLITE_WORKER_COMMANDS.cancel,
            payload: { requestId },
          });
        } catch {
          // The timed-out caller is already detached. Late responses are ignored.
        }
      }, Math.max(1, Number(timeoutMs) || this.requestTimeoutMs));

      const onAbort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.cleanup();
        reject(createAbortError());
        try {
          worker.postMessage({
            requestId: `${requestId}-cancel`,
            command: SQLITE_WORKER_COMMANDS.cancel,
            payload: { requestId },
          });
        } catch {
          // Best effort only.
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
      };
      this.pending.set(requestId, { resolve, reject, cleanup, command, onProgress });
      signal?.addEventListener?.('abort', onAbort, { once: true });
      try {
        worker.postMessage({ requestId, command, payload });
      } catch (error) {
        this.pending.delete(requestId);
        cleanup();
        reject(error);
      }
    });
  }

  initialize(options = {}, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.initialize, options, requestOptions);
  }

  async waitForWriter(options = {}, {
    maxWaitMs = 5_000,
    pollMs = 100,
    ...requestOptions
  } = {}) {
    const startedAt = Date.now();
    let initialization;
    do {
      initialization = await this.initialize(options, requestOptions);
      if (initialization?.initialized || initialization?.role !== 'recovery_readonly') {
        return initialization;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxWaitMs) return initialization;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, maxWaitMs - elapsed)));
    } while (!this.closed);
    return initialization;
  }

  applyMigrations(migrations, options = {}, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.applyMigrations, { migrations, options }, requestOptions);
  }

  executeAtomic(command, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.executeAtomic, { command }, requestOptions);
  }

  query(statement, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.query, { statement }, requestOptions);
  }

  integrityCheck(options = {}, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.integrityCheck, options, requestOptions);
  }

  exportSnapshot(options = {}, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.exportSnapshot, options, requestOptions);
  }

  verifySnapshot(snapshot, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.verifySnapshot, { snapshot }, requestOptions);
  }

  stageSnapshot(snapshot, options = {}, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.stageSnapshot, { snapshot, options }, requestOptions);
  }

  restoreSnapshot(snapshot, requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.restoreSnapshot, { snapshot }, requestOptions);
  }

  status(requestOptions) {
    return this.call(SQLITE_WORKER_COMMANDS.status, {}, requestOptions);
  }

  async close({ terminate = true, markClean = true, timeoutMs = 5_000 } = {}) {
    if (this.closed) return { closed: true, alreadyClosed: true };
    let result = { closed: true };
    if (this.worker && !this.failed) {
      try {
        result = await this.call(
          SQLITE_WORKER_COMMANDS.close,
          { markClean },
          { timeoutMs },
        );
      } finally {
        if (terminate) this.terminate();
      }
    } else if (terminate) {
      this.terminate();
    }
    return result;
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    this.worker?.terminate?.();
    this.worker = null;
    const error = new SqliteRuntimeError('SQLite worker was terminated.', {
      code: SQLITE_ERROR_CODES.workerTerminated,
    });
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export default SqliteWorkerClient;
