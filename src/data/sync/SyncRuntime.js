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
import { registerDeviceWithTimeout } from './DeviceRegistrationGate.js';

const COMMIT_SYNC_DELAY_MS = Object.freeze({
  live: 0,
  prompt: 750,
  background: 15_000,
});
const LIVE_COMMIT_REFERENCE_TYPES = new Set([
  'active-profile-state',
  'completed-task',
  'action-session',
  'match',
  'match-score-event',
]);
const PROMPT_COMMIT_REFERENCE_TYPES = new Set([
  'profile',
  'task',
  'task-completion-event',
  'task-completion-receipt',
  'reminder',
  'goal',
  'goal-area',
  'goal-milestone',
  'goal-update',
  'goal-link',
  'goal-participant',
  'shop-catalog',
  'inventory',
  'transaction',
  'event',
  'custom-event',
  'rhythm-definition',
  'rhythm-opportunity',
]);

function commitSyncLane({ referenceTypes = [], commandQueued = false, label = '' } = {}) {
  if (commandQueued || referenceTypes.some((type) => LIVE_COMMIT_REFERENCE_TYPES.has(type))) return 'live';
  if (/match|action-session|task-session/i.test(String(label || ''))) return 'live';
  if (referenceTypes.some((type) => PROMPT_COMMIT_REFERENCE_TYPES.has(type))) return 'prompt';
  return 'background';
}

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
    deviceRegistrationTimeoutMs = 10_000,
  } = {}) {
    if (!client?.query || !client?.executeAtomic) throw new Error('SyncRuntime requires a SQLite client.');
    this.client = client;
    this.connection = connection;
    this.transport = transport;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.deviceRegistrationTimeoutMs = Math.max(1, Number(deviceRegistrationTimeoutMs) || 10_000);
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
    this.scheduledDueAt = null;
    this.retryAttempt = 0;
    this.started = false;
    this.transportUnsubscribe = null;
    this.deviceRegistrationPromise = null;
    this.registeredDeviceKey = null;
    this.syncRequested = false;
    this.syncRequestedReason = null;
    this.afterSynchronize = null;
    this.checkpointDirty = false;
    this.checkpointGeneration = 0;
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

  async configure({ transport = this.transport, device = null, schedule = true } = {}) {
    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;
    this.transport?.unsubscribe?.();
    this.transport = transport;
    this.deviceRegistrationPromise = null;
    this.registeredDeviceKey = null;
    if (device) this.device = await this.devices.register(device);
    else if (!this.device) this.device = await this.devices.getActive();
    if (this.transport && this.device) {
      this.transportUnsubscribe = this.transport.subscribe?.(
        (nudge = {}) => {
          // Realtime is only a wake-up signal. One coalesced cursor pull reads
          // every reference change after the durable local checkpoint; the
          // websocket payload is never treated as the source of truth.
          this.scheduleSync(nudge?.source === 'mobile-reference'
            ? 'realtime-reference-nudge'
            : 'realtime-sync-log-nudge');
        },
      ) || null;
    }
    this.statusStore.setTransportConfigured(Boolean(this.transport));
    await this.statusStore.refresh();
    if (schedule && this.transport && this.device) this.scheduleSync('configured');
    return { device: this.device, status: this.getStatus() };
  }

  ensureDeviceRegistered() {
    if (!this.transport?.registerDevice || !this.device) {
      return Promise.resolve({ registered: false, reason: 'registration-not-required' });
    }
    const registrationKey = [
      this.device.ownerId || '',
      this.device.id || '',
    ].map(String).join(':');
    if (this.registeredDeviceKey === registrationKey) {
      return Promise.resolve({ registered: true, reason: 'already-registered' });
    }
    if (this.deviceRegistrationPromise) return this.deviceRegistrationPromise;

    this.deviceRegistrationPromise = registerDeviceWithTimeout({
      register: ({ signal }) => this.transport.registerDevice(this.device, { signal }),
      timeoutMs: this.deviceRegistrationTimeoutMs,
      setTimeoutFn: this.setTimeoutFn,
      clearTimeoutFn: this.clearTimeoutFn,
    })
      .then((result) => {
        this.registeredDeviceKey = registrationKey;
        return result;
      })
      .finally(() => {
        this.deviceRegistrationPromise = null;
      });

    return this.deviceRegistrationPromise;
  }


  buildReferenceOutboxStatements(operations = [], options = {}) {
    return this.referenceOutbox.buildMutationStatements(operations, options);
  }

  referenceTypesForOperations(operations = []) {
    return this.referenceOutbox.recordTypesForMutations(operations);
  }

  queueReferenceSeed(records = []) {
    return this.referenceOutbox.queueReferences(records);
  }

  async queueActiveProfileState(activePlayerUUID, changedAt = this.now().toISOString()) {
    const playerId = String(activePlayerUUID || '').trim();
    if (!playerId || this.connection?.demoMode) {
      return { queued: 0, reason: playerId ? 'demo-mode' : 'missing-active-profile' };
    }
    const updatedAt = new Date(changedAt || this.now()).toISOString();
    const result = await this.referenceOutbox.queueReferences([{
      recordType: 'active-profile-state',
      recordId: 'active',
      workspaceId: null,
      playerId,
      data: {
        UUID: 'active',
        activePlayerUUID: playerId,
        changedAt: updatedAt,
      },
      updatedAt,
    }]);
    await this.statusStore.refresh();
    return result;
  }

  isReferenceMirrorSeeded(schemaVersion = 0) {
    return this.referenceOutbox.isSeeded({ schemaVersion });
  }

  markReferenceMirrorSeeded(details = {}) {
    return this.referenceOutbox.markSeeded(details);
  }

  reconcileReferenceOutbox(records = []) {
    return this.referenceOutbox.reconcileRemote(records);
  }

  async flushReferenceOutbox({ limit = 500, recordTypes = null } = {}) {
    if (!this.transport?.mergeMobileReferenceRecords) {
      return { uploaded: 0, reason: 'transport-unavailable' };
    }
    let uploaded = 0;
    while (true) {
      const pending = await this.referenceOutbox.listPending({ limit, recordTypes });
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
    const checkpointGeneration = this.checkpointGeneration;
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
        // A write may land while snapshot export or upload is in flight. Only
        // clear the dirty flag when the uploaded generation is still current.
        this.checkpointDirty = this.checkpointGeneration !== checkpointGeneration;
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

  databaseCommitted(details = {}) {
    this.checkpointGeneration += 1;
    this.checkpointDirty = true;
    if (this.transport) {
      const label = details?.command?.label || details?.statement?.sql || '';
      const lane = commitSyncLane({ label });
      this.scheduleSync(`sqlite-commit:${lane}`, { delayMs: COMMIT_SYNC_DELAY_MS[lane] });
    }
  }

  async operationCommitted({ referenceTypes = [], commandQueued = false, label = '' } = {}) {
    const lane = commitSyncLane({ referenceTypes, commandQueued, label });
    if (this.transport) {
      this.scheduleSync(`operation-commit:${lane}`, { delayMs: COMMIT_SYNC_DELAY_MS[lane] });
    }
    await this.statusStore.refresh();
  }

  cancelScheduledSync() {
    if (this.scheduledTimer != null) this.clearTimeoutFn(this.scheduledTimer);
    this.scheduledTimer = null;
    this.scheduledDueAt = null;
  }

  scheduleSync(reason = 'scheduled', { delayMs = 0 } = {}) {
    if (!this.transport) return;
    if (this.syncPromise) {
      this.syncRequested = true;
      this.syncRequestedReason = reason;
      return;
    }
    const delay = this.retryAttempt > 0
      ? Math.min(60_000, 1000 * (2 ** Math.min(6, this.retryAttempt - 1)))
      : Math.max(0, Number(delayMs) || 0);
    const dueAt = this.now().getTime() + delay;
    if (this.scheduledTimer != null) {
      if (Number(this.scheduledDueAt) <= dueAt) return;
      this.clearTimeoutFn(this.scheduledTimer);
      this.scheduledTimer = null;
      this.scheduledDueAt = null;
    }
    this.scheduledDueAt = dueAt;
    this.scheduledTimer = this.setTimeoutFn(() => {
      this.scheduledTimer = null;
      this.scheduledDueAt = null;
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
        await this.ensureDeviceRegistered();
        const uploaded = await this._push(limit);
        const pulled = await this._pull(limit);
        const supplemental = await this.afterSynchronize?.({ reason }) || null;
        // Remote profile, Match, completion, and contribution writes queue
        // derived snapshots. Settle those projections before telling React
        // that sync completed so Elo, Points, IGT, and graphs refresh together.
        await this.connection?.flushSyncProjections?.();
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
        const followUpRequested = this.syncRequested;
        const followUpReason = this.syncRequestedReason || 'coalesced-nudge';
        this.syncRequested = false;
        this.syncRequestedReason = null;
        this.statusStore.setActivity('idle');
        this.syncPromise = null;
        await this.statusStore.refresh();
        if (this.retryAttempt > 0) this.scheduleSync('retry');
        else if (followUpRequested) this.scheduleSync(followUpReason);
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
    this.syncRequested = false;
    this.syncRequestedReason = null;
  }
}

export default SyncRuntime;
