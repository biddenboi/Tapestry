import DeviceIdentityService from './DeviceIdentityService.js';
import RemoteOperationApplier from './RemoteOperationApplier.js';
import SyncCommandRegistry from './SyncCommandRegistry.js';
import SyncConflictRepository from './SyncConflictRepository.js';
import SyncCoordinator from './SyncCoordinator.js';
import SyncCursorRepository from './SyncCursorRepository.js';
import SyncOperationRepository from './SyncOperationRepository.js';
import SyncStatusStore from './SyncStatusStore.js';
import { SYNC_ORIGIN } from './SyncContracts.js';
import DurableReferenceOutbox from './DurableReferenceOutbox.js';

function responseResults(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

export class SyncRuntime {
  constructor({
    client,
    connection,
    transport = null,
    now = () => new Date(),
    windowRef = typeof window === 'undefined' ? null : window,
    // Wrap browser timers so later method-style invocation does not change
    // the native Window receiver and throw "Illegal invocation".
    setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeoutFn = (timer) => globalThis.clearTimeout(timer),
  } = {}) {
    if (!client?.query || !client?.executeAtomic) throw new Error('SyncRuntime requires a SQLite client.');
    this.client = client;
    this.connection = connection;
    this.transport = transport;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.windowRef = windowRef;
    this.operations = new SyncOperationRepository(client, { now });
    this.referenceOutbox = new DurableReferenceOutbox(client, { now });
    this.cursors = new SyncCursorRepository(client, { now });
    this.conflicts = new SyncConflictRepository(client, { now });
    this.devices = new DeviceIdentityService(client, { now });
    this.registry = new SyncCommandRegistry();
    this.statusStore = new SyncStatusStore({
      operations: this.operations,
      conflicts: this.conflicts,
      cursors: this.cursors,
      referenceOutbox: this.referenceOutbox,
    });
    this.remoteApplier = connection ? new RemoteOperationApplier({
      connection,
      registry: this.registry,
      operations: this.operations,
      cursors: this.cursors,
      conflicts: this.conflicts,
      now,
    }) : null;
    this.coordinator = new SyncCoordinator({ runtime: this, windowRef });
    this.device = null;
    this.syncPromise = null;
    this.scheduledTimer = null;
    this.retryAttempt = 0;
    this.started = false;
    this.transportUnsubscribe = null;
    this.afterSynchronize = null;
    this.checkpointDirty = false;
    this.checkpointPublishingEnabled = false;
    this.lastCheckpointAt = 0;
    this.checkpointPromise = null;
    this.statusStore.setTransportConfigured(Boolean(transport));
  }

  async initialize({ start = true } = {}) {
    await this.operations.recoverUploading();
    this.device = await this.devices.getActive();
    await this.statusStore.refresh();
    if (start) {
      this.started = true;
      this.coordinator.start();
    }
    return this.getStatus();
  }

  async configure({ transport = this.transport, device = null } = {}) {
    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;
    this.transport?.unsubscribe?.();
    this.transport = transport;
    if (device) this.device = await this.devices.register(device);
    else if (!this.device) this.device = await this.devices.getActive();
    if (this.transport && this.device) {
      await this.transport.registerDevice?.(this.device);
      this.transportUnsubscribe = this.transport.subscribe?.(
        () => this.scheduleSync('realtime-nudge'),
      ) || null;
    }
    this.statusStore.setTransportConfigured(Boolean(this.transport));
    await this.statusStore.refresh();
    if (this.transport && this.device) this.scheduleSync('configured');
    return { device: this.device, status: this.getStatus() };
  }


  buildReferenceOutboxStatements(operations = [], options = {}) {
    return this.referenceOutbox.buildMutationStatements(operations, options);
  }

  queueReferenceSeed(records = []) {
    return this.referenceOutbox.queueReferences(records);
  }

  isReferenceMirrorSeeded() {
    return this.referenceOutbox.isSeeded();
  }

  markReferenceMirrorSeeded(details = {}) {
    return this.referenceOutbox.markSeeded(details);
  }

  reconcileReferenceOutbox(records = []) {
    return this.referenceOutbox.reconcileRemote(records);
  }

  async flushReferenceOutbox({ limit = 500 } = {}) {
    if (!this.transport?.mergeMobileReferenceRecords) {
      return { uploaded: 0, reason: 'transport-unavailable' };
    }
    let uploaded = 0;
    while (true) {
      const pending = await this.referenceOutbox.listPending({ limit });
      if (!pending.length) break;
      try {
        await this.transport.mergeMobileReferenceRecords(pending);
        const settled = await this.referenceOutbox.settle(pending);
        uploaded += Number(settled.settled || 0);
      } catch (error) {
        await this.referenceOutbox.fail(pending, error);
        throw error;
      }
      if (pending.length < limit) break;
    }
    return { uploaded };
  }

  setCheckpointPublishingEnabled(enabled) {
    this.checkpointPublishingEnabled = Boolean(enabled);
  }

  publishCloudCheckpoint({ force = false, reason = 'scheduled' } = {}) {
    void reason;
    if (!this.checkpointPublishingEnabled) {
      return Promise.resolve({ uploaded: false, reason: 'checkpoint-publication-gated' });
    }
    if (this.checkpointPromise) return this.checkpointPromise;
    if (!this.transport?.uploadDatabaseCheckpoint || !this.connection) {
      return Promise.resolve({ uploaded: false, reason: 'checkpoint-transport-unavailable' });
    }
    const nowMs = this.now().getTime();
    const minimumIntervalMs = 5 * 60 * 1000;
    if (!force && !this.checkpointDirty) {
      return Promise.resolve({ uploaded: false, reason: 'checkpoint-clean' });
    }
    if (!force && nowMs - this.lastCheckpointAt < minimumIntervalMs) {
      return Promise.resolve({ uploaded: false, reason: 'checkpoint-deferred' });
    }
    this.checkpointPromise = (async () => {
      await this.connection.flushWrites?.();
      const adapter = this.connection.persistenceRuntime?.sqliteStorageAdapter;
      const snapshot = await adapter?.exportSnapshot?.({}, { timeoutMs: 30_000 });
      if (!snapshot?.byteArray?.byteLength || snapshot.quickCheck !== 'ok'
          || snapshot.foreignKeyViolations?.length) {
        throw new Error('A verified SQLite checkpoint could not be created.');
      }
      const createdAt = this.now().toISOString();
      const result = await this.transport.uploadDatabaseCheckpoint({
        bytes: snapshot.byteArray,
        deviceId: this.device?.id,
        createdAt,
      });
      if (result?.uploaded) {
        this.lastCheckpointAt = this.now().getTime();
        this.checkpointDirty = false;
      }
      return result;
    })().finally(() => {
      this.checkpointPromise = null;
    });
    return this.checkpointPromise;
  }

  registerCommand(commandType, handler) {
    return this.registry.register(commandType, handler);
  }

  createCommandContext({
    origin = SYNC_ORIGIN.desktop,
    enqueueSync = true,
    operationId,
    playerId = null,
    workspaceId = null,
    commandType,
    entityType,
    entityId,
    baseVersion = null,
    payload = {},
    occurredAt = this.now(),
  } = {}) {
    if (origin === SYNC_ORIGIN.remote) {
      return { origin, enqueueSync: false };
    }
    if (!enqueueSync || !this.device) return { origin, enqueueSync: false };
    return {
      origin,
      enqueueSync: true,
      operationId,
      ownerId: this.device.ownerId,
      playerId,
      workspaceId,
      deviceId: this.device.id,
      commandType,
      entityType,
      entityId,
      baseVersion,
      payload,
      occurredAt,
    };
  }

  getStatus() {
    return this.statusStore.getSnapshot();
  }

  async getDiagnostics() {
    const [, referenceOutbox] = await Promise.all([
      this.statusStore.refresh(),
      this.referenceOutbox.diagnostics(),
    ]);
    return { ...this.getStatus(), referenceOutbox };
  }

  databaseCommitted() {
    this.checkpointDirty = true;
    if (this.transport) this.scheduleSync('sqlite-commit');
  }

  async operationCommitted() {
    this.databaseCommitted();
    await this.statusStore.refresh();
  }

  cancelScheduledSync() {
    if (this.scheduledTimer != null) this.clearTimeoutFn(this.scheduledTimer);
    this.scheduledTimer = null;
  }

  scheduleSync(reason = 'scheduled') {
    void reason;
    if (!this.transport || this.scheduledTimer != null || this.syncPromise) return;
    const delay = this.retryAttempt > 0
      ? Math.min(60_000, 1000 * (2 ** Math.min(6, this.retryAttempt - 1)))
      : 0;
    this.scheduledTimer = this.setTimeoutFn(() => {
      this.scheduledTimer = null;
      void this.synchronize({ reason }).catch(() => undefined);
    }, delay);
  }

  async _push(limit) {
    let uploaded = 0;
    while (true) {
      const pending = await this.operations.listPending({ limit });
      if (!pending.length) break;
      const claimed = await this.operations.claimPending(pending.map(({ operationId }) => operationId));
      if (!claimed.length) break;
      let results;
      try {
        const response = await this.transport.push({
          operations: claimed,
          device: this.device,
        });
        results = responseResults(response);
      } catch (error) {
        await this.operations.returnToPending(claimed.map(({ operationId }) => operationId), error);
        throw error;
      }
      const byId = new Map(results.map((result) => [String(result?.operationId || ''), result]));
      const acknowledged = claimed
        .map((operation) => byId.get(operation.operationId))
        .filter(Boolean);
      await this.operations.settle(acknowledged);
      uploaded += acknowledged.filter(({ status }) => status === 'accepted').length;
      const missing = claimed.filter((operation) => !byId.has(operation.operationId));
      if (missing.length) {
        const error = new Error('The server response omitted one or more operation acknowledgements.');
        error.code = 'sync-response-missing';
        await this.operations.returnToPending(
          missing.map(({ operationId }) => operationId),
          error,
        );
        throw error;
      }
      if (claimed.length < limit) break;
    }
    return uploaded;
  }

  async _pull(limit) {
    if (!this.transport?.pull || !this.remoteApplier) return 0;
    let pulled = 0;
    while (true) {
      const cursor = await this.cursors.get('owner');
      const response = await this.transport.pull({
        after: cursor.serverSequence,
        limit,
        device: this.device,
      });
      const entries = Array.isArray(response) ? response : response?.entries || [];
      if (!entries.length) break;
      const result = await this.remoteApplier.apply(entries, { streamName: 'owner' });
      const processed = Number(result.applied || 0)
        + Number(result.duplicates || 0)
        + Number(result.conflicts || 0);
      pulled += processed;
      if (processed === 0) break;
      if (entries.length < limit) break;
    }
    return pulled;
  }

  synchronize({ reason = 'manual', limit = 100 } = {}) {
    void reason;
    if (this.syncPromise) return this.syncPromise;
    if (!this.transport) {
      return this.statusStore.refresh().then(() => ({
        synchronized: false,
        reason: 'local-only',
        status: this.getStatus(),
      }));
    }
    this.cancelScheduledSync();
    this.syncPromise = (async () => {
      this.statusStore.setActivity('syncing');
      await this.statusStore.refresh();
      try {
        const uploaded = await this._push(limit);
        const pulled = await this._pull(limit);
        const supplemental = await this.afterSynchronize?.({ reason }) || null;
        const retention = await this.operations.pruneAccepted({
          olderThan: new Date(this.now().getTime() - 30 * 24 * 60 * 60 * 1000),
          keepNewest: 250,
        });
        this.retryAttempt = 0;
        this.statusStore.setRuntimeError(null);
        this.statusStore.markSynchronized();
        const SyncEvent = this.windowRef?.CustomEvent || globalThis.CustomEvent;
        if (SyncEvent && this.windowRef?.dispatchEvent) {
          this.windowRef.dispatchEvent(new SyncEvent('tapestry:sync-complete', {
            detail: { reason, uploaded, pulled, supplemental },
          }));
        }
        return { synchronized: true, uploaded, pulled, supplemental, retention };
      } catch (error) {
        this.retryAttempt += 1;
        this.statusStore.setRuntimeError(error);
        throw error;
      } finally {
        this.statusStore.setActivity('idle');
        this.syncPromise = null;
        await this.statusStore.refresh();
        if (this.retryAttempt > 0) this.scheduleSync('retry');
      }
    })();
    return this.syncPromise;
  }

  stop() {
    this.started = false;
    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;
    this.transport?.unsubscribe?.();
    this.coordinator.stop();
  }
}

export default SyncRuntime;
