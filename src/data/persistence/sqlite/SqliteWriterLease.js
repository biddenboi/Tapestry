import { SQLITE_RUNTIME_POLICY } from './SqliteRuntimePolicy.js';
import { SQLITE_ERROR_CODES, SqliteRuntimeError } from './sqliteErrors.js';

export class SqliteWriterLease {
  constructor({
    locks = globalThis.navigator?.locks || null,
    name = SQLITE_RUNTIME_POLICY.writerLease,
  } = {}) {
    this.locks = locks;
    this.name = name;
    this.held = false;
    this.releaseCurrent = null;
    this.requestPromise = null;
  }

  async acquire({ required = true, ifAvailable = true } = {}) {
    if (this.held) return { acquired: true, name: this.name, reused: true };
    if (!required) return { acquired: true, name: this.name, bypassed: true };
    if (!this.locks?.request) {
      throw new SqliteRuntimeError('Web Locks are required for the selected SQLite writer policy.', {
        code: SQLITE_ERROR_CODES.unavailable,
        details: { lease: this.name },
      });
    }

    let settle;
    const acquired = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    this.requestPromise = this.locks.request(
      this.name,
      { mode: 'exclusive', ifAvailable },
      async (lock) => {
        if (!lock) {
          settle.resolve({ acquired: false, name: this.name });
          return;
        }
        this.held = true;
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        this.releaseCurrent = release;
        settle.resolve({ acquired: true, name: this.name, reused: false });
        await held;
        this.held = false;
        this.releaseCurrent = null;
      },
    ).catch((error) => {
      settle.reject(error);
      throw error;
    });
    return acquired;
  }

  async release() {
    if (this.releaseCurrent) this.releaseCurrent();
    try {
      await this.requestPromise;
    } catch {
      // Acquisition errors are reported by acquire(). Release remains best-effort.
    }
    this.requestPromise = null;
    this.held = false;
    this.releaseCurrent = null;
    return { released: true, name: this.name };
  }
}

export default SqliteWriterLease;
