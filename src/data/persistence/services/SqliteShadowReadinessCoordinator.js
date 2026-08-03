export const SQLITE_SHADOW_PROJECTION = Object.freeze({
  coreProfiles: 'coreProfiles',
  planning: 'planning',
  matches: 'matches',
  social: 'social',
});

export const SQLITE_SHADOW_PROJECTIONS = Object.freeze(
  Object.values(SQLITE_SHADOW_PROJECTION),
);

export const SQLITE_SHADOW_READINESS_STATE = Object.freeze({
  uninitialized: 'uninitialized',
  synchronizing: 'synchronizing',
  ready: 'ready',
  failed: 'failed',
  dirty: 'dirty',
});

function assertProjection(domain) {
  if (!SQLITE_SHADOW_PROJECTIONS.includes(domain)) {
    throw new TypeError(`Unknown SQLite shadow projection: ${domain}`);
  }
  return domain;
}

function errorDetails(error) {
  if (!error) return null;
  return Object.freeze({
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code || null,
  });
}

export class SqliteShadowSourceNotReadyError extends Error {
  constructor(states, { cause = null } = {}) {
    super('Dynamic fellow sources are not ready.', cause ? { cause } : undefined);
    this.name = 'SqliteShadowSourceNotReadyError';
    this.code = 'social-cast-source-not-ready';
    this.states = Object.freeze(states);
  }
}

export class SqliteShadowReadinessCoordinator {
  constructor({ sessionId = globalThis.crypto?.randomUUID?.() || `sqlite-shadow-${Date.now()}` } = {}) {
    this.sessionId = String(sessionId);
    this.generation = 0;
    this.entries = new Map();
    this.inflight = new Map();
    this.reset();
  }

  _entry(domain) {
    return this.entries.get(assertProjection(domain));
  }

  begin(domain, synchronize = null) {
    const key = assertProjection(domain);
    if (this.inflight.has(key)) {
      const current = this.inflight.get(key);
      if (this._entry(key).state === SQLITE_SHADOW_READINESS_STATE.dirty
          && typeof synchronize === 'function') {
        return current.then(
          () => this.begin(key, synchronize),
          () => this.begin(key, synchronize),
        );
      }
      return current;
    }

    const previous = this._entry(key);
    this.entries.set(key, Object.freeze({
      domain: key,
      state: SQLITE_SHADOW_READINESS_STATE.synchronizing,
      sessionId: this.sessionId,
      generation: this.generation,
      revision: previous.revision,
      sourceFingerprint: previous.sourceFingerprint || null,
      runId: previous.runId || null,
      error: null,
    }));
    if (typeof synchronize !== 'function') return null;

    const generation = this.generation;
    const revision = previous.revision;
    const promise = Promise.resolve()
      .then(synchronize)
      .then((result = {}) => {
        if (this.generation === generation
            && this._entry(key).revision === revision
            && this._entry(key).state === SQLITE_SHADOW_READINESS_STATE.synchronizing) {
          this.markReady(key, {
            sourceFingerprint: result.sourceFingerprint || null,
            runId: result.runId || null,
          });
        }
        return result;
      })
      .catch((error) => {
        if (this.generation === generation
            && this._entry(key).revision === revision
            && this._entry(key).state === SQLITE_SHADOW_READINESS_STATE.synchronizing) {
          this.markFailed(key, error);
        }
        throw error;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  markReady(domain, { sourceFingerprint = null, runId = null } = {}) {
    const key = assertProjection(domain);
    const entry = Object.freeze({
      domain: key,
      state: SQLITE_SHADOW_READINESS_STATE.ready,
      sessionId: this.sessionId,
      generation: this.generation,
      revision: this._entry(key).revision,
      sourceFingerprint: sourceFingerprint == null ? null : String(sourceFingerprint),
      runId: runId == null ? null : String(runId),
      error: null,
    });
    this.entries.set(key, entry);
    return entry;
  }

  markFailed(domain, error) {
    const key = assertProjection(domain);
    const previous = this._entry(key);
    const entry = Object.freeze({
      ...previous,
      state: SQLITE_SHADOW_READINESS_STATE.failed,
      error: errorDetails(error),
    });
    this.entries.set(key, entry);
    return entry;
  }

  markDirty(domain) {
    const key = assertProjection(domain);
    const previous = this._entry(key);
    const entry = Object.freeze({
      ...previous,
      state: SQLITE_SHADOW_READINESS_STATE.dirty,
      revision: previous.revision + 1,
      error: null,
    });
    this.entries.set(key, entry);
    return entry;
  }

  getState(domain) {
    return this._entry(domain);
  }

  assertReady(domains) {
    const required = [...new Set((Array.isArray(domains) ? domains : [domains]).map(assertProjection))];
    const states = Object.freeze(required.map((domain) => this.getState(domain)));
    const unavailable = states.filter((entry) => entry.state !== SQLITE_SHADOW_READINESS_STATE.ready);
    if (unavailable.length) {
      const failed = unavailable.find((entry) => entry.state === SQLITE_SHADOW_READINESS_STATE.failed);
      throw new SqliteShadowSourceNotReadyError(states, {
        cause: failed?.error ? Object.assign(new Error(failed.error.message), failed.error) : null,
      });
    }
    return states;
  }

  reset({ sessionId = this.sessionId } = {}) {
    this.sessionId = String(sessionId);
    this.generation += 1;
    this.inflight.clear();
    this.entries = new Map(SQLITE_SHADOW_PROJECTIONS.map((domain) => [domain, Object.freeze({
      domain,
      state: SQLITE_SHADOW_READINESS_STATE.uninitialized,
      sessionId: this.sessionId,
      generation: this.generation,
      revision: 0,
      sourceFingerprint: null,
      runId: null,
      error: null,
    })]));
    return this.generation;
  }
}

export default SqliteShadowReadinessCoordinator;
