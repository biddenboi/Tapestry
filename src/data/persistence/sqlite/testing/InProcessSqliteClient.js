import SqliteRuntime from '../SqliteRuntime.js';

// Node-test-only client with the same methods as SqliteWorkerClient. It keeps
// parity tests on the real SQLite WASM engine without pretending a Node mock
// is evidence for OPFS behavior.
export class InProcessSqliteClient {
  constructor({ runtime = new SqliteRuntime({ logger: { warn() {} } }) } = {}) {
    this.runtime = runtime;
  }

  initialize(options) { return this.runtime.initialize(options); }
  applyMigrations(migrations, options) { return this.runtime.applyMigrations(migrations, options); }
  executeAtomic(command) { return this.runtime.executeAtomic(command); }
  query(statement) { return Promise.resolve(this.runtime.query(statement)); }
  integrityCheck(options) { return Promise.resolve(this.runtime.integrityCheck(options)); }
  exportSnapshot() { return Promise.resolve(this.runtime.exportSnapshot()); }
  verifySnapshot(snapshot) { return Promise.resolve(this.runtime.verifySnapshot(snapshot)); }
  stageSnapshot(snapshot, options) { return Promise.resolve(this.runtime.stageSnapshot(snapshot, options)); }
  restoreSnapshot(snapshot) { return Promise.resolve(this.runtime.restoreSnapshot(snapshot)); }
  status() { return Promise.resolve(this.runtime.status()); }
  close(options) { return this.runtime.close(options); }
}

export default InProcessSqliteClient;
