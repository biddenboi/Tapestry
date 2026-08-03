export const SQLITE_ERROR_CODES = Object.freeze({
  invalidRequest: 'SQLITE_INVALID_REQUEST',
  notInitialized: 'SQLITE_NOT_INITIALIZED',
  unavailable: 'SQLITE_RUNTIME_UNAVAILABLE',
  writerUnavailable: 'SQLITE_WRITER_UNAVAILABLE',
  requestTimeout: 'SQLITE_REQUEST_TIMEOUT',
  workerTerminated: 'SQLITE_WORKER_TERMINATED',
  workerFailure: 'SQLITE_WORKER_FAILURE',
  aborted: 'SQLITE_REQUEST_ABORTED',
  busy: 'SQLITE_BUSY',
  migrationChecksumMismatch: 'SQLITE_MIGRATION_CHECKSUM_MISMATCH',
  migrationFailed: 'SQLITE_MIGRATION_FAILED',
  integrityFailed: 'SQLITE_INTEGRITY_FAILED',
  documentRepositoryDisabled: 'SQLITE_DOCUMENT_REPOSITORY_DISABLED',
  invalidAtomicBatch: 'SQLITE_INVALID_ATOMIC_BATCH',
});

export class SqliteRuntimeError extends Error {
  constructor(message, {
    code = SQLITE_ERROR_CODES.workerFailure,
    details = null,
    retryable = false,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SqliteRuntimeError';
    this.code = code;
    this.details = details;
    this.retryable = Boolean(retryable);
  }
}

export function sqliteErrorCode(error) {
  if (error?.code) return String(error.code);
  if (error?.resultCode === 5 || /\bSQLITE_BUSY\b|database is locked/i.test(error?.message || '')) {
    return SQLITE_ERROR_CODES.busy;
  }
  return SQLITE_ERROR_CODES.workerFailure;
}

export function normalizeSqliteError(error, fallback = {}) {
  if (error instanceof SqliteRuntimeError) return error;
  const code = sqliteErrorCode(error) || fallback.code;
  return new SqliteRuntimeError(error?.message || String(error), {
    ...fallback,
    code,
    retryable: code === SQLITE_ERROR_CODES.busy || fallback.retryable,
    cause: error,
    details: fallback.details || null,
  });
}

export function serializeSqliteError(error) {
  const normalized = normalizeSqliteError(error);
  return {
    name: normalized.name || 'Error',
    message: normalized.message || String(error),
    code: normalized.code || SQLITE_ERROR_CODES.workerFailure,
    retryable: Boolean(normalized.retryable),
    details: normalized.details ?? null,
    stack: normalized.stack || null,
  };
}

export function hydrateSqliteError(payload, fallbackMessage = 'SQLite worker request failed.') {
  const error = new SqliteRuntimeError(payload?.message || fallbackMessage, {
    code: payload?.code || SQLITE_ERROR_CODES.workerFailure,
    retryable: Boolean(payload?.retryable),
    details: payload?.details ?? null,
  });
  error.name = payload?.name || 'SqliteRuntimeError';
  if (payload?.stack) error.remoteStack = payload.stack;
  return error;
}
