import StorageAdapter from '../ports/StorageAdapter.js';
import MigrationRunner from './MigrationRunner.js';
import SqliteWorkerClient from './SqliteWorkerClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import { SQLITE_ERROR_CODES, SqliteRuntimeError } from './sqliteErrors.js';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';
import SqliteShadowDomainRuntime from './SqliteShadowDomainRuntime.js';
import { sha256Bytes } from '../resources/ResourceOperationService.js';


function mutationStatement(statement = {}) {
  const sql = String(statement?.sql || '').trim();
  if (!sql) return false;
  return /^(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX)\b/i.test(sql)
    || /^PRAGMA\s+(?!query_only|table_info|foreign_key_list|integrity_check|quick_check)/i.test(sql);
}

function changedRows(result) {
  if (typeof result === 'number') return result > 0;
  if (typeof result?.changes === 'number') return result.changes > 0;
  if (Array.isArray(result?.statementResults)) {
    return result.statementResults.some((entry) => Number(entry?.changes || 0) > 0);
  }
  return false;
}

function documentRepositoryDisabled(operation) {
  throw new SqliteRuntimeError(
    `SQLite document ${operation} is disabled until a document repository is installed.`,
    { code: SQLITE_ERROR_CODES.documentRepositoryDisabled, details: { operation } },
  );
}

export class SqliteStorageAdapter extends StorageAdapter {
  constructor({
    client = new SqliteWorkerClient(),
    migrations = SQLITE_MIGRATIONS,
    applicationVersion = 'batch11-13',
    documents = null,
    enableDocuments = true,
  } = {}) {
    let documentRepository = documents;
    const getDocumentMethod = (operation) => {
      const method = documentRepository?.[operation];
      if (typeof method !== 'function') return documentRepositoryDisabled(operation);
      return method.bind(documentRepository);
    };
    super({
      get: (...args) => getDocumentMethod('get')(...args),
      getAll: (...args) => getDocumentMethod('getAll')(...args),
      put: (...args) => getDocumentMethod('put')(...args),
      remove: (...args) => getDocumentMethod('remove')(...args),
      clear: (...args) => getDocumentMethod('clear')(...args),
      range: (...args) => getDocumentMethod('range')(...args),
      transaction: (command, options) => {
        if (typeof command === 'function') {
          throw new SqliteRuntimeError(
            'SQLite transactions must be worker-side command descriptors, not async callbacks.',
            { code: SQLITE_ERROR_CODES.invalidAtomicBatch },
          );
        }
        return client.executeAtomic(command, options);
      },
    });
    this.commitListener = null;
    const executeAtomic = client.executeAtomic.bind(client);
    const query = client.query.bind(client);
    client.executeAtomic = async (...args) => {
      const result = await executeAtomic(...args);
      if (changedRows(result)) this._notifyCommitted({ kind: 'atomic', command: args[0] });
      return result;
    };
    client.query = async (...args) => {
      const result = await query(...args);
      if (mutationStatement(args[0]) && changedRows(result)) {
        this._notifyCommitted({ kind: 'statement', statement: args[0] });
      }
      return result;
    };
    this.client = client;
    if (!documentRepository && enableDocuments) {
      documentRepository = new SqliteDocumentRepository(client);
    }
    this.documents = documentRepository;
    this.shadowDomains = new SqliteShadowDomainRuntime({ client });
    this.migrationRunner = new MigrationRunner({ client, migrations, applicationVersion });
    this.opened = false;
    this.role = 'closed';
    this.lastPreMigrationBackup = null;
  }

  async _prepareMigrationBackup({ mode, migrations }) {
    if (mode !== 'persistent' || !migrations?.length) return null;
    const hasMigrationTable = await this.client.query({
      sql: "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='schema_migrations'",
      result: 'value',
    });
    if (!hasMigrationTable) return null;
    const sourceSchemaVersion = await this.client.query({
      sql: "SELECT migration_id FROM schema_migrations WHERE outcome='applied' ORDER BY migration_id DESC LIMIT 1",
      result: 'value',
    });
    const targetSchemaVersion = migrations.at(-1)?.id || null;
    if (!targetSchemaVersion || String(sourceSchemaVersion || '') >= targetSchemaVersion) return null;

    const startedAt = new Date().toISOString();
    const snapshot = await this.client.exportSnapshot({}, { timeoutMs: 30_000 });
    const verified = await this.client.verifySnapshot(
      { byteArray: snapshot.byteArray },
      { timeoutMs: 30_000 },
    );
    if (
      snapshot.quickCheck !== 'ok'
      || snapshot.foreignKeyViolations?.length
      || verified.quickCheck !== 'ok'
      || verified.integrityCheck !== 'ok'
      || verified.foreignKeyViolations?.length
    ) {
      throw new Error('Verified pre-migration backup could not be created. Migration was stopped.');
    }
    const documentTables = await this.client.query({
      sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'document_%' ORDER BY name",
      result: 'all',
    });
    const recordCounts = {};
    for (const { name } of documentTables) {
      recordCounts[name] = await this.client.query({
        sql: `SELECT COUNT(*) FROM "${String(name).replaceAll('"', '""')}"`,
        result: 'value',
      });
    }
    const backup = {
      id: `migration-backup:${sourceSchemaVersion || 'unknown'}:${targetSchemaVersion}:${startedAt}`,
      sourceSchemaVersion: sourceSchemaVersion || null,
      targetSchemaVersion,
      sourceApplicationVersion: this.migrationRunner.applicationVersion,
      manifestChecksum: await sha256Bytes(snapshot.byteArray),
      snapshotByteLength: snapshot.byteArray.byteLength,
      recordCounts,
      startedAt,
      byteArray: new Uint8Array(snapshot.byteArray),
    };
    this.lastPreMigrationBackup = backup;
    return backup;
  }

  async _recordMigrationBackup(backup, outcome, error = null) {
    if (!backup) return;
    await this.client.query({
      sql: `INSERT INTO migration_safety_receipts(
              id,source_schema_version,target_schema_version,source_application_version,
              manifest_checksum,snapshot_byte_length,record_counts_json,started_at,
              completed_at,outcome,error_message
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              completed_at=excluded.completed_at,outcome=excluded.outcome,error_message=excluded.error_message`,
      bind: [
        backup.id,
        backup.sourceSchemaVersion,
        backup.targetSchemaVersion,
        backup.sourceApplicationVersion,
        backup.manifestChecksum,
        backup.snapshotByteLength,
        JSON.stringify(backup.recordCounts),
        backup.startedAt,
        new Date().toISOString(),
        outcome,
        error ? String(error.message || error).slice(0, 1000) : null,
      ],
      result: 'changes',
    });
  }

  async open({
    mode = 'persistent',
    migrate = true,
    writerLeaseWaitMs = 0,
    writerLeasePollMs = 100,
    ...options
  } = {}) {
    const requestOptions = {
      timeoutMs: mode === 'persistent' ? 20_000 : 10_000,
    };
    const initialization = writerLeaseWaitMs > 0
      ? await this.client.waitForWriter({ mode, ...options }, {
        ...requestOptions,
        maxWaitMs: writerLeaseWaitMs,
        pollMs: writerLeasePollMs,
      })
      : await this.client.initialize({ mode, ...options }, requestOptions);
    this.role = initialization.role;
    if (!initialization.initialized) return { initialization, migrations: null };
    const backup = migrate
      ? await this._prepareMigrationBackup({ mode, migrations: this.migrationRunner.migrations })
      : null;
    let migrations = null;
    try {
      migrations = migrate ? await this.migrationRunner.run() : null;
      await this._recordMigrationBackup(backup, 'completed');
    } catch (error) {
      if (backup) {
        try {
          await this._recordMigrationBackup(backup, 'failed', error);
        } catch {
          // The migration may have failed before the receipt table existed.
        }
      }
      throw error;
    }
    this.opened = true;
    return { initialization, migrations };
  }

  setCommitListener(listener = null) {
    this.commitListener = typeof listener === 'function' ? listener : null;
  }

  _notifyCommitted(details) {
    if (!this.commitListener) return;
    try {
      this.commitListener(details);
    } catch (error) {
      console.warn('[Tapestry] SQLite commit listener failed after a durable write.', error);
    }
  }

  executeAtomic(command, options) {
    return this.client.executeAtomic(command, options);
  }

  query(statement, options) {
    return this.client.query(statement, options);
  }

  integrityCheck(options, requestOptions) {
    return this.client.integrityCheck(options, requestOptions);
  }

  exportSnapshot(options, requestOptions) { return this.client.exportSnapshot(options, requestOptions); }
  verifySnapshot(snapshot, requestOptions) { return this.client.verifySnapshot(snapshot, requestOptions); }
  stageSnapshot(snapshot, options, requestOptions) { return this.client.stageSnapshot(snapshot, options, requestOptions); }
  restoreSnapshot(snapshot, requestOptions) { return this.client.restoreSnapshot(snapshot, requestOptions); }
  applyPendingMigrations() { return this.migrationRunner.run(); }

  status(options) {
    return this.client.status(options);
  }

  async close(options) {
    const result = await this.client.close(options);
    this.opened = false;
    this.role = 'closed';
    return result;
  }
}

export default SqliteStorageAdapter;
