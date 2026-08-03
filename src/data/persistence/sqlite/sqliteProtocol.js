import { SQLITE_ERROR_CODES, SqliteRuntimeError } from './sqliteErrors.js';

export const SQLITE_WORKER_COMMANDS = Object.freeze({
  initialize: 'initialize',
  applyMigrations: 'applyMigrations',
  executeAtomic: 'executeAtomic',
  query: 'query',
  integrityCheck: 'integrityCheck',
  status: 'status',
  close: 'close',
  cancel: 'cancel',
  testDelay: '__testDelay',
  exportSnapshot: 'exportSnapshot',
  verifySnapshot: 'verifySnapshot',
  stageSnapshot: 'stageSnapshot',
  restoreSnapshot: 'restoreSnapshot',
});

export const SQLITE_RESULT_MODES = Object.freeze({
  none: 'none',
  changes: 'changes',
  one: 'one',
  all: 'all',
  value: 'value',
  values: 'values',
});

const RESULT_MODES = new Set(Object.values(SQLITE_RESULT_MODES));
const TRANSACTION_CONTROL = /^\s*(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

export function validateStatement(statement, { allowExplain = true } = {}) {
  if (!statement || typeof statement !== 'object') {
    throw new SqliteRuntimeError('SQLite statement must be an object.', {
      code: SQLITE_ERROR_CODES.invalidRequest,
    });
  }
  const sql = String(statement.sql || '').trim();
  if (!sql) {
    throw new SqliteRuntimeError('SQLite statement SQL cannot be empty.', {
      code: SQLITE_ERROR_CODES.invalidRequest,
    });
  }
  if (TRANSACTION_CONTROL.test(sql)) {
    throw new SqliteRuntimeError('Transaction control is worker-owned and cannot be sent by clients.', {
      code: SQLITE_ERROR_CODES.invalidAtomicBatch,
      details: { sql: sql.slice(0, 80) },
    });
  }
  if (!allowExplain && /^\s*EXPLAIN\b/i.test(sql)) {
    throw new SqliteRuntimeError('EXPLAIN is not allowed for this command.', {
      code: SQLITE_ERROR_CODES.invalidRequest,
    });
  }
  const result = statement.result || SQLITE_RESULT_MODES.none;
  if (!RESULT_MODES.has(result)) {
    throw new SqliteRuntimeError(`Unknown SQLite result mode: ${result}`, {
      code: SQLITE_ERROR_CODES.invalidRequest,
    });
  }
  const bind = statement.bind == null ? [] : statement.bind;
  if (!Array.isArray(bind) && (typeof bind !== 'object' || bind instanceof Uint8Array)) {
    throw new SqliteRuntimeError('SQLite statement bindings must be an array or named-binding object.', {
      code: SQLITE_ERROR_CODES.invalidRequest,
    });
  }
  return Object.freeze({ sql, bind, result });
}

export function validateAtomicCommand(command) {
  if (!command || typeof command !== 'object') {
    throw new SqliteRuntimeError('Atomic SQLite command must be an object.', {
      code: SQLITE_ERROR_CODES.invalidAtomicBatch,
    });
  }
  const commandId = String(command.commandId || '').trim();
  if (!commandId) {
    throw new SqliteRuntimeError('Atomic SQLite commands require a stable commandId.', {
      code: SQLITE_ERROR_CODES.invalidAtomicBatch,
    });
  }
  const statements = (command.statements || []).map((statement) => validateStatement(statement));
  if (!statements.length) {
    throw new SqliteRuntimeError('Atomic SQLite commands require at least one statement.', {
      code: SQLITE_ERROR_CODES.invalidAtomicBatch,
    });
  }
  return Object.freeze({
    commandId,
    label: String(command.label || 'atomic-command'),
    statements,
    maxBusyRetries: Math.max(0, Math.min(4, command.maxBusyRetries == null
      ? 2
      : Number(command.maxBusyRetries) || 0)),
  });
}
