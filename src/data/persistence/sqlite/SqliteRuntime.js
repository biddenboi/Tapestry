import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SQLITE_RUNTIME_POLICY } from './SqliteRuntimePolicy.js';
import {
  SQLITE_ERROR_CODES,
  SqliteRuntimeError,
  normalizeSqliteError,
} from './sqliteErrors.js';
import {
  SQLITE_RESULT_MODES,
  validateAtomicCommand,
  validateStatement,
} from './sqliteProtocol.js';

export const TAPESTRY_SQLITE_APPLICATION_ID = 0x54505354; // "TPST"
export const SQLITE_CONTROL_SCHEMA_VERSION = 1;

const MIGRATION_CONTROL_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_application_version TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'applied', 'failed')),
  error_message TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS database_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`.trim();

const asIso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
};

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function isBusyError(error) {
  return error?.resultCode === 5
    || error?.code === SQLITE_ERROR_CODES.busy
    || /\bSQLITE_BUSY\b|database is locked/i.test(error?.message || '');
}

export class SqliteRuntime {
  constructor({
    sqlite3Init = sqlite3InitModule,
    now = () => new Date(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    random = Math.random,
    logger = console,
  } = {}) {
    this.sqlite3Init = sqlite3Init;
    this.now = now;
    this.sleep = sleep;
    this.random = random;
    this.logger = logger;
    this.sqlite3 = null;
    this.database = null;
    this.poolUtil = null;
    this.initialized = false;
    this.mode = null;
    this.role = 'closed';
    this.previousCleanShutdown = null;
    this.lastIntegrity = null;
    this.configuration = null;
  }

  _timestamp() {
    return asIso(this.now());
  }

  _requireDatabase() {
    if (!this.database?.isOpen?.()) {
      throw new SqliteRuntimeError('SQLite runtime is not initialized.', {
        code: SQLITE_ERROR_CODES.notInitialized,
      });
    }
    return this.database;
  }

  _metadataGet(key) {
    const database = this._requireDatabase();
    const value = database.selectValue('SELECT value FROM database_metadata WHERE key=?', [key]);
    return value == null ? null : String(value);
  }

  _metadataSet(key, value, timestamp = this._timestamp()) {
    const database = this._requireDatabase();
    database.exec({
      sql: `
INSERT INTO database_metadata(key,value,updated_at)
VALUES(?,?,?)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
`.trim(),
      bind: [String(key), String(value), timestamp],
    });
  }

  _metadataObject() {
    const database = this._requireDatabase();
    return Object.fromEntries(
      database.selectObjects('SELECT key,value FROM database_metadata ORDER BY key')
        .map(({ key, value }) => [String(key), parseJson(value, value)]),
    );
  }

  async initialize({
    mode = 'memory',
    databaseFilename = SQLITE_RUNTIME_POLICY.databaseFilename,
    poolDirectory = '/tapestry-sqlite-sahpool-v1',
    poolName = 'tapestry-sahpool-v1',
    poolCapacity = 8,
    role = 'writer',
    runUncleanIntegrityCheck = true,
  } = {}) {
    if (role !== 'writer') {
      this.role = role;
      return {
        initialized: false,
        role,
        reason: 'writer-lease-unavailable',
      };
    }
    await this.close({ markClean: false });
    if (!this.sqlite3) {
      const wasmUrl = globalThis.__TAPESTRY_SQLITE_WASM_URL__;
      this.sqlite3 = await this.sqlite3Init({
        print: () => undefined,
        printErr: (...args) => this.logger?.warn?.('[sqlite-runtime]', ...args),
        ...(typeof wasmUrl === 'string' && wasmUrl
          ? { locateFile: () => wasmUrl }
          : {}),
      });
    }

    this.mode = mode;
    this.configuration = {
      mode,
      databaseFilename,
      poolDirectory,
      poolName,
      poolCapacity,
    };
    try {
      if (mode === 'memory') {
        this.database = new this.sqlite3.oo1.DB(':memory:', 'c');
      } else if (mode === 'persistent') {
        if (typeof this.sqlite3.installOpfsSAHPoolVfs !== 'function') {
          throw new SqliteRuntimeError('The selected opfs-sahpool VFS is unavailable.', {
            code: SQLITE_ERROR_CODES.unavailable,
          });
        }
        this.poolUtil = await this.sqlite3.installOpfsSAHPoolVfs({
          name: poolName,
          directory: poolDirectory,
          initialCapacity: poolCapacity,
        });
        this.database = new this.poolUtil.OpfsSAHPoolDb(databaseFilename, 'c');
      } else {
        throw new SqliteRuntimeError(`Unknown SQLite runtime mode: ${mode}`, {
          code: SQLITE_ERROR_CODES.invalidRequest,
        });
      }

      const database = this._requireDatabase();
      database.exec(`
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=${Number(SQLITE_RUNTIME_POLICY.busyTimeoutMs)};
PRAGMA journal_mode=${SQLITE_RUNTIME_POLICY.journalMode};
PRAGMA application_id=${TAPESTRY_SQLITE_APPLICATION_ID};
`.trim());
      database.exec(MIGRATION_CONTROL_SQL);

      this.previousCleanShutdown = this._metadataGet('runtime.clean_shutdown');
      const openedAt = this._timestamp();
      this._metadataSet('runtime.clean_shutdown', JSON.stringify(false), openedAt);
      this._metadataSet('runtime.opened_at', JSON.stringify(openedAt), openedAt);
      this._metadataSet('runtime.sqlite_version', JSON.stringify(this.sqlite3.version.libVersion), openedAt);
      this._metadataSet('runtime.vfs', JSON.stringify(database.dbVfsName() || 'memory'), openedAt);
      this._metadataSet('runtime.control_schema_version', JSON.stringify(SQLITE_CONTROL_SCHEMA_VERSION), openedAt);
      this._metadataSet('runtime.mode', JSON.stringify(mode), openedAt);
      this.initialized = true;
      this.role = 'writer';

      let uncleanIntegrity = null;
      if (runUncleanIntegrityCheck && this.previousCleanShutdown === 'false') {
        uncleanIntegrity = this.integrityCheck({ mode: 'quick', reason: 'unclean-shutdown' });
      }
      return {
        initialized: true,
        role: this.role,
        mode,
        filename: database.filename,
        sqliteVersion: this.sqlite3.version.libVersion,
        sourceId: this.sqlite3.version.sourceId,
        vfs: database.dbVfsName(),
        pragmas: {
          foreignKeys: Number(database.selectValue('PRAGMA foreign_keys')),
          busyTimeoutMs: Number(database.selectValue('PRAGMA busy_timeout')),
          journalMode: String(database.selectValue('PRAGMA journal_mode')),
          applicationId: Number(database.selectValue('PRAGMA application_id')),
        },
        previousCleanShutdown: parseJson(this.previousCleanShutdown, null),
        uncleanIntegrity,
        poolCapacity: this.poolUtil?.getCapacity?.() ?? null,
      };
    } catch (error) {
      await this.close({ markClean: false });
      throw normalizeSqliteError(error, { code: SQLITE_ERROR_CODES.unavailable });
    }
  }

  exportSnapshot() {
    const database = this._requireDatabase();
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const byteArray = this.sqlite3.capi.sqlite3_js_db_export(database.pointer);
    return {
      byteArray,
      byteLength: byteArray.byteLength,
      filename: database.filename,
      sqliteVersion: this.sqlite3.version.libVersion,
      migrations: database.selectObjects("SELECT migration_id AS id, checksum FROM schema_migrations WHERE outcome='applied' ORDER BY migration_id"),
      quickCheck: String(database.selectValue('PRAGMA quick_check')),
      foreignKeyViolations: database.selectObjects('PRAGMA foreign_key_check'),
    };
  }

  _openSerializedSnapshot(byteArray) {
    const bytes = byteArray instanceof Uint8Array ? byteArray : new Uint8Array(byteArray || []);
    if (bytes.byteLength < 100 || new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\u0000') {
      throw new SqliteRuntimeError('Backup does not contain a valid SQLite database image.', { code: SQLITE_ERROR_CODES.invalidRequest });
    }
    const database = new this.sqlite3.oo1.DB(':memory:', 'c');
    const capi = this.sqlite3.capi;
    const wasm = this.sqlite3.wasm;
    const pointer = capi.sqlite3_malloc64(bytes.byteLength);
    if (!pointer) {
      database.close();
      throw new Error('Unable to allocate memory for SQLite snapshot verification.');
    }
    wasm.heap8u().set(bytes, pointer);
    const flags = (capi.SQLITE_DESERIALIZE_FREEONCLOSE || 1) | (capi.SQLITE_DESERIALIZE_RESIZEABLE || 2);
    const rc = capi.sqlite3_deserialize(database.pointer, 'main', pointer, bytes.byteLength, bytes.byteLength, flags);
    if (rc) {
      capi.sqlite3_free(pointer);
      database.close();
      throw new Error(`sqlite3_deserialize failed with code ${rc}`);
    }
    return database;
  }

  verifySnapshot({ byteArray } = {}) {
    const database = this._openSerializedSnapshot(byteArray);
    try {
      return {
        valid: true,
        quickCheck: String(database.selectValue('PRAGMA quick_check')),
        integrityCheck: String(database.selectValue('PRAGMA integrity_check')),
        foreignKeyViolations: database.selectObjects('PRAGMA foreign_key_check'),
        applicationId: Number(database.selectValue('PRAGMA application_id')),
        migrations: database.selectObjects("SELECT migration_id AS id, checksum FROM schema_migrations WHERE outcome='applied' ORDER BY migration_id"),
      };
    } finally {
      database.close();
    }
  }

  async stageSnapshot({ byteArray } = {}, { targetFilename = null } = {}) {
    const verification = this.verifySnapshot({ byteArray });
    if (verification.quickCheck !== 'ok' || verification.integrityCheck !== 'ok' || verification.foreignKeyViolations.length) {
      throw new Error('SQLite snapshot failed staged integrity verification.');
    }
    if (this.mode !== 'persistent') {
      return { staged: true, persistent: false, targetFilename: null, verification };
    }
    const filename = String(targetFilename || `/tapestry-restore-staging-${Date.now()}.sqlite3`);
    if (filename === this.configuration.databaseFilename) throw new Error('Restore staging must not overwrite the active database.');
    await this.poolUtil.importDb(filename, byteArray);
    const staged = new this.poolUtil.OpfsSAHPoolDb(filename, 'r');
    try {
      const quickCheck = String(staged.selectValue('PRAGMA quick_check'));
      const integrityCheck = String(staged.selectValue('PRAGMA integrity_check'));
      const foreignKeyViolations = staged.selectObjects('PRAGMA foreign_key_check');
      if (quickCheck !== 'ok' || integrityCheck !== 'ok' || foreignKeyViolations.length) throw new Error('Imported staging database failed integrity checks.');
      return { staged: true, persistent: true, targetFilename: filename, verification: { ...verification, quickCheck, integrityCheck, foreignKeyViolations } };
    } finally {
      staged.close();
    }
  }

  async restoreSnapshot({ byteArray } = {}) {
    const verification = this.verifySnapshot({ byteArray });
    if (verification.quickCheck !== 'ok'
      || verification.integrityCheck !== 'ok'
      || verification.foreignKeyViolations.length) {
      throw new Error('SQLite restore snapshot failed integrity verification.');
    }
    const bytes = byteArray instanceof Uint8Array ? byteArray : new Uint8Array(byteArray || []);
    const previous = this.exportSnapshot().byteArray;
    if (this.mode === 'memory') {
      const replacement = this._openSerializedSnapshot(bytes);
      this.database.close();
      this.database = replacement;
      return { restored: true, persistent: false, verification };
    }

    const filename = this.configuration.databaseFilename;
    this.database.close();
    this.database = null;
    try {
      await this.poolUtil.importDb(filename, bytes);
      this.database = new this.poolUtil.OpfsSAHPoolDb(filename, 'c');
      this.database.exec('PRAGMA foreign_keys=ON');
      this.database.exec(`PRAGMA busy_timeout=${SQLITE_RUNTIME_POLICY.busyTimeoutMs}`);
      const quickCheck = String(this.database.selectValue('PRAGMA quick_check'));
      const foreignKeyViolations = this.database.selectObjects('PRAGMA foreign_key_check');
      if (quickCheck !== 'ok' || foreignKeyViolations.length) {
        throw new Error('Restored SQLite database failed post-activation verification.');
      }
      return { restored: true, persistent: true, verification };
    } catch (error) {
      await this.poolUtil.importDb(filename, previous);
      this.database = new this.poolUtil.OpfsSAHPoolDb(filename, 'c');
      this.database.exec('PRAGMA foreign_keys=ON');
      this.database.exec(`PRAGMA busy_timeout=${SQLITE_RUNTIME_POLICY.busyTimeoutMs}`);
      throw error;
    }
  }

  status() {
    if (!this.database?.isOpen?.()) {
      return {
        initialized: false,
        role: this.role,
        mode: this.mode,
      };
    }
    const database = this._requireDatabase();
    return {
      initialized: this.initialized,
      role: this.role,
      mode: this.mode,
      filename: database.filename,
      vfs: database.dbVfsName(),
      sqliteVersion: this.sqlite3?.version?.libVersion || null,
      previousCleanShutdown: parseJson(this.previousCleanShutdown, null),
      migrations: database.selectObjects(`
SELECT migration_id AS id, checksum, started_at AS startedAt,
       finished_at AS finishedAt, source_application_version AS sourceApplicationVersion,
       outcome, error_message AS errorMessage
FROM schema_migrations
ORDER BY migration_id
`.trim()),
      metadata: this._metadataObject(),
      lastIntegrity: this.lastIntegrity,
    };
  }

  _executeStatement(statement) {
    const database = this._requireDatabase();
    const { sql, bind, result } = validateStatement(statement);
    const hasBind = Array.isArray(bind) ? bind.length > 0 : Object.keys(bind || {}).length > 0;
    if (result === SQLITE_RESULT_MODES.one) return (hasBind ? database.selectObject(sql, bind) : database.selectObject(sql)) || null;
    if (result === SQLITE_RESULT_MODES.all) return hasBind ? database.selectObjects(sql, bind) : database.selectObjects(sql);
    if (result === SQLITE_RESULT_MODES.value) return (hasBind ? database.selectValue(sql, bind) : database.selectValue(sql)) ?? null;
    if (result === SQLITE_RESULT_MODES.values) return hasBind ? database.selectValues(sql, bind) : database.selectValues(sql);
    database.exec(hasBind ? { sql, bind } : sql);
    if (result === SQLITE_RESULT_MODES.changes) return { changes: Number(database.changes()) };
    return null;
  }

  query(statement) {
    return this._executeStatement(validateStatement(statement));
  }

  async executeAtomic(command, { beforeCommit = null } = {}) {
    const validated = validateAtomicCommand(command);
    const database = this._requireDatabase();
    const existing = database.selectObject(
      'SELECT result_json AS resultJson FROM runtime_command_receipts WHERE command_id=?',
      [validated.commandId],
    );
    if (existing) {
      return {
        ...parseJson(existing.resultJson, {}),
        duplicate: true,
      };
    }

    let attempt = 0;
    while (true) {
      try {
        const committedAt = this._timestamp();
        const result = database.transaction('IMMEDIATE', () => {
          const statementResults = validated.statements.map((statement) => this._executeStatement(statement));
          const payload = {
            commandId: validated.commandId,
            label: validated.label,
            duplicate: false,
            statementResults,
            committedAt,
          };
          if (beforeCommit) beforeCommit({ database, payload, attempt });
          database.exec({
            sql: `
INSERT INTO runtime_command_receipts(command_id,command_label,result_json,committed_at)
VALUES(?,?,?,?)
`.trim(),
            bind: [validated.commandId, validated.label, JSON.stringify(payload), committedAt],
          });
          return payload;
        });
        return result;
      } catch (error) {
        if (!isBusyError(error) || attempt >= validated.maxBusyRetries) {
          throw normalizeSqliteError(error, {
            code: isBusyError(error) ? SQLITE_ERROR_CODES.busy : SQLITE_ERROR_CODES.workerFailure,
            retryable: isBusyError(error),
            details: { commandId: validated.commandId, attempt },
          });
        }
        attempt += 1;
        const jitterMs = 20 + Math.floor(this.random() * 31) + attempt * 25;
        await this.sleep(jitterMs);
        const duplicate = database.selectObject(
          'SELECT result_json AS resultJson FROM runtime_command_receipts WHERE command_id=?',
          [validated.commandId],
        );
        if (duplicate) return { ...parseJson(duplicate.resultJson, {}), duplicate: true };
      }
    }
  }

  applyMigrations(migrations = [], {
    applicationVersion = 'unknown',
  } = {}) {
    const database = this._requireDatabase();
    const ordered = [...migrations].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const applied = [];
    const skipped = [];
    for (const migration of ordered) {
      const id = String(migration?.id || '').trim();
      const checksum = String(migration?.checksum || '').trim();
      const sql = String(migration?.sql || '').trim();
      if (!id || !checksum || !sql) {
        throw new SqliteRuntimeError('Migration id, checksum, and SQL are required.', {
          code: SQLITE_ERROR_CODES.invalidRequest,
          details: { id },
        });
      }
      const compatibilityRepairs = (migration?.compatibilityRepairs || []).map((repair) => {
        const migrationId = String(repair?.migrationId || '').trim();
        const checksums = new Set((repair?.checksums || []).map((value) => String(value).trim()).filter(Boolean));
        const repairSql = String(repair?.sql || '').trim();
        if (!migrationId || !checksums.size || !repairSql) {
          throw new SqliteRuntimeError('Compatibility repair migration id, checksums, and SQL are required.', {
            code: SQLITE_ERROR_CODES.invalidRequest,
            details: { id, migrationId },
          });
        }
        return { migrationId, checksums, sql: repairSql };
      });
      const existing = database.selectObject(
        'SELECT checksum,outcome FROM schema_migrations WHERE migration_id=?',
        [id],
      );
      const compatibleChecksums = new Set((migration?.compatibleChecksums || []).map((value) => String(value).trim()));
      if (existing?.checksum && existing.checksum !== checksum && !compatibleChecksums.has(existing.checksum)) {
        throw new SqliteRuntimeError(`Migration checksum changed after registration: ${id} (${existing.checksum} → ${checksum})`, {
          code: SQLITE_ERROR_CODES.migrationChecksumMismatch,
          details: { id, expected: existing.checksum, received: checksum },
        });
      }
      if (existing?.outcome === 'applied') {
        skipped.push(id);
        continue;
      }

      const startedAt = this._timestamp();
      database.exec({
        sql: `
INSERT INTO schema_migrations(
  migration_id,checksum,started_at,finished_at,source_application_version,outcome,error_message
) VALUES(?,?,?,?,?,'started',NULL)
ON CONFLICT(migration_id) DO UPDATE SET
  checksum=excluded.checksum,
  started_at=excluded.started_at,
  finished_at=NULL,
  source_application_version=excluded.source_application_version,
  outcome='started',
  error_message=NULL
`.trim(),
        bind: [id, checksum, startedAt, null, migration.sourceApplicationVersion || applicationVersion],
      });
      try {
        const finishedAt = this._timestamp();
        database.transaction('IMMEDIATE', () => {
          for (const repair of compatibilityRepairs) {
            const registeredChecksum = database.selectValue(
              "SELECT checksum FROM schema_migrations WHERE migration_id=? AND outcome='applied'",
              [repair.migrationId],
            );
            if (repair.checksums.has(String(registeredChecksum || ''))) {
              database.exec(repair.sql);
            }
          }
          database.exec(sql);
          database.exec({
            sql: `
UPDATE schema_migrations
SET finished_at=?, outcome='applied', error_message=NULL
WHERE migration_id=? AND checksum=?
`.trim(),
            bind: [finishedAt, id, checksum],
          });
        });
        applied.push(id);
      } catch (error) {
        const failedAt = this._timestamp();
        database.exec({
          sql: `
UPDATE schema_migrations
SET finished_at=?, outcome='failed', error_message=?
WHERE migration_id=? AND checksum=?
`.trim(),
          bind: [failedAt, String(error?.message || error).slice(0, 1000), id, checksum],
        });
        throw new SqliteRuntimeError(`SQLite migration failed: ${id}`, {
          code: SQLITE_ERROR_CODES.migrationFailed,
          details: { id, checksum },
          cause: error,
        });
      }
    }
    const timestamp = this._timestamp();
    const latest = ordered.at(-1)?.id || null;
    this._metadataSet('schema.latest_migration', JSON.stringify(latest), timestamp);
    this._metadataSet('schema.migration_count', JSON.stringify(ordered.length), timestamp);
    return { applied, skipped, latest };
  }

  integrityCheck({ mode = 'quick', reason = 'explicit' } = {}) {
    const database = this._requireDatabase();
    const pragma = mode === 'full' ? 'integrity_check' : 'quick_check';
    const integrityRows = database.selectValues(`PRAGMA ${pragma}`)
      .map((value) => String(value));
    const foreignKeys = database.selectObjects('PRAGMA foreign_key_check');
    const ok = integrityRows.length === 1 && integrityRows[0] === 'ok' && foreignKeys.length === 0;
    const result = {
      ok,
      mode: mode === 'full' ? 'full' : 'quick',
      reason,
      checkedAt: this._timestamp(),
      integrityRows,
      foreignKeyViolations: foreignKeys,
    };
    this.lastIntegrity = result;
    this._metadataSet('integrity.last_result', JSON.stringify(result));
    if (!ok) {
      throw new SqliteRuntimeError('SQLite integrity checks failed.', {
        code: SQLITE_ERROR_CODES.integrityFailed,
        details: result,
      });
    }
    return result;
  }

  async close({ markClean = true } = {}) {
    if (this.database?.isOpen?.()) {
      if (markClean) {
        try {
          const timestamp = this._timestamp();
          this._metadataSet('runtime.clean_shutdown', JSON.stringify(true), timestamp);
          this._metadataSet('runtime.closed_at', JSON.stringify(timestamp), timestamp);
        } catch (error) {
          this.logger?.warn?.('[sqlite-runtime] failed to record clean shutdown', error);
        }
      }
      this.database.close();
    }
    this.database = null;
    this.poolUtil = null;
    this.initialized = false;
    this.role = 'closed';
    return { closed: true, clean: Boolean(markClean) };
  }
}

export default SqliteRuntime;
