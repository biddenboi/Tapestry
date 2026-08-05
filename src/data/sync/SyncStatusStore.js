import { visibleSyncError } from './SyncErrorPolicy.js';

export const SYNC_STATUS = Object.freeze({
  localOnly: 'local-only',
  pending: 'pending',
  syncing: 'syncing',
  synced: 'synced',
  conflict: 'conflict',
  error: 'error',
});

const LABELS = Object.freeze({
  [SYNC_STATUS.localOnly]: 'Local only',
  [SYNC_STATUS.pending]: 'Pending',
  [SYNC_STATUS.syncing]: 'Syncing',
  [SYNC_STATUS.synced]: 'Synced',
  [SYNC_STATUS.conflict]: 'Conflict',
  [SYNC_STATUS.error]: 'Error',
});

const EMPTY_COUNTS = Object.freeze({
  pending: 0,
  uploading: 0,
  accepted: 0,
  conflict: 0,
  rejected: 0,
});

export class SyncStatusStore {
  constructor({ operations, conflicts, cursors, referenceOutbox = null } = {}) {
    this.operations = operations;
    this.conflicts = conflicts;
    this.cursors = cursors;
    this.referenceOutbox = referenceOutbox;
    this.listeners = new Set();
    this.transportConfigured = false;
    this.activity = 'idle';
    this.runtimeError = null;
    this.lastSynchronizedAt = null;
    this.snapshot = Object.freeze({
      status: SYNC_STATUS.localOnly,
      label: LABELS[SYNC_STATUS.localOnly],
      counts: EMPTY_COUNTS,
      openConflictCount: 0,
      cursors: [],
      oldestPending: null,
      latestError: null,
      transportConfigured: false,
      refreshedAt: null,
      lastSynchronizedAt: null,
      referencePending: 0,
    });
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  setTransportConfigured(configured) {
    this.transportConfigured = Boolean(configured);
  }

  setActivity(activity = 'idle') {
    this.activity = String(activity || 'idle');
  }

  setRuntimeError(error = null) {
    this.runtimeError = error ? {
      code: String(error.code || 'sync-failed'),
      message: String(error.message || error).slice(0, 1000),
      updatedAt: new Date().toISOString(),
    } : null;
  }

  markSynchronized(at = new Date().toISOString()) {
    this.lastSynchronizedAt = at;
  }

  async refresh() {
    const [diagnostics, conflicts, cursors, referenceDiagnostics] = await Promise.all([
      this.operations.diagnostics(),
      this.conflicts.listOpen({ limit: 500 }),
      this.cursors.list(),
      this.referenceOutbox?.diagnostics?.() || Promise.resolve({ pending: 0 }),
    ]);
    const referencePending = Math.max(0, Number(referenceDiagnostics?.pending || 0));
    const counts = {
      ...EMPTY_COUNTS,
      ...diagnostics.counts,
      pending: Number(diagnostics.counts?.pending || 0) + referencePending,
      referencePending,
    };
    const runtimeError = visibleSyncError(this.runtimeError);
    const operationError = visibleSyncError(diagnostics.latestError);
    const referenceError = visibleSyncError(referenceDiagnostics?.latestError);
    let status = SYNC_STATUS.localOnly;
    if (conflicts.length || counts.conflict > 0) status = SYNC_STATUS.conflict;
    else if (counts.rejected > 0 || operationError || referenceError || runtimeError) status = SYNC_STATUS.error;
    else if (this.activity === 'syncing' || counts.uploading > 0) status = SYNC_STATUS.syncing;
    else if (counts.pending > 0) status = SYNC_STATUS.pending;
    else if (this.transportConfigured) status = SYNC_STATUS.synced;
    this.snapshot = Object.freeze({
      status,
      label: LABELS[status],
      counts: Object.freeze(counts),
      openConflictCount: conflicts.length,
      cursors: Object.freeze(cursors),
      oldestPending: diagnostics.oldestPending,
      latestError: runtimeError || operationError || referenceError || null,
      transportConfigured: this.transportConfigured,
      refreshedAt: new Date().toISOString(),
      lastSynchronizedAt: this.lastSynchronizedAt,
      referencePending,
    });
    for (const listener of this.listeners) listener();
    return this.snapshot;
  }
}

export default SyncStatusStore;
