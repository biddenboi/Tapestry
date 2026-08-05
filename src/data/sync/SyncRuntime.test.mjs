import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from '../persistence/sqlite/testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from '../persistence/sqlite/migrations/index.js';
import SqliteDocumentRepository from '../persistence/sqlite/SqliteDocumentRepository.js';
import DeviceIdentityService from './DeviceIdentityService.js';
import SyncRuntime from './SyncRuntime.js';
import { referenceCaptureGuard } from './ReferenceCaptureGuard.js';
import {
  buildSyncOutboxStatement,
  normalizeSyncContext,
  SYNC_ORIGIN,
} from './SyncContracts.js';

const FIXED = new Date('2026-08-02T12:00:00.000Z');

async function createContext() {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'sync-runtime-test' });
  const documents = new SqliteDocumentRepository(client);
  const devices = new DeviceIdentityService(client, { now: () => FIXED });
  await devices.register({
    id: 'device-1',
    ownerId: 'owner-1',
    displayName: 'Test device',
    platform: 'test',
  });
  return { client, documents };
}

function commandContext(operationId, entityId = 'todo-1') {
  return normalizeSyncContext({
    origin: SYNC_ORIGIN.mobile,
    enqueueSync: true,
    operationId,
    ownerId: 'owner-1',
    playerId: 'player-1',
    workspaceId: 'workspace:default',
    deviceId: 'device-1',
    commandType: 'updateTask',
    entityType: 'task',
    entityId,
    baseVersion: 1,
    payload: { name: 'Original' },
    occurredAt: FIXED,
  }, { now: FIXED });
}

async function commitTodo(documents, operationId, name) {
  const context = commandContext(operationId);
  return documents.commitBatch({
    commandId: operationId,
    label: 'test-synchronized-task',
    operations: [{
      type: 'put',
      store: 'todos',
      record: {
        UUID: 'todo-1',
        parent: 'player-1',
        name,
        createdAt: FIXED.toISOString(),
      },
    }],
    additionalStatements: [buildSyncOutboxStatement(context)],
  });
}

test('local mutation and outbox commit atomically and duplicate operation IDs are no-ops', async (t) => {
  const { client, documents } = await createContext();
  t.after(() => client.close());

  const first = await commitTodo(documents, 'operation-1', 'Original');
  const duplicate = await commitTodo(documents, 'operation-1', 'Must not replace original');
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await documents.get('todos', 'todo-1')).name, 'Original');

  const operation = await client.query({
    sql: `SELECT status,workspace_id AS workspaceId,device_sequence AS deviceSequence,payload_json AS payloadJson
          FROM sync_operations WHERE operation_id='operation-1'`,
    result: 'one',
  });
  assert.equal(operation.status, 'pending');
  assert.equal(operation.workspaceId, 'workspace:default');
  assert.equal(Number(operation.deviceSequence), 1);
  assert.deepEqual(JSON.parse(operation.payloadJson), { name: 'Original' });
  assert.equal(await client.query({ sql: 'SELECT COUNT(*) FROM sync_operations', result: 'value' }), 1);
});

test('pending operations survive database close and snapshot restoration', async (t) => {
  const first = await createContext();
  await commitTodo(first.documents, 'operation-restart', 'Survives restart');
  const snapshot = await first.client.exportSnapshot();
  await first.client.close();

  const restored = new InProcessSqliteClient();
  await restored.initialize({ mode: 'memory' });
  t.after(() => restored.close());
  await restored.restoreSnapshot({ byteArray: snapshot.byteArray });
  const row = await restored.query({
    sql: `SELECT status,command_type AS commandType
          FROM sync_operations WHERE operation_id='operation-restart'`,
    result: 'one',
  });
  assert.deepEqual(row, { status: 'pending', commandType: 'updateTask' });
});

test('remote-sync context is structurally unable to enqueue an outgoing operation', () => {
  assert.throws(() => normalizeSyncContext({
    origin: SYNC_ORIGIN.remote,
    enqueueSync: true,
  }), (error) => error?.code === 'sync-remote-reenqueue-forbidden');
});

test('remote document application cannot echo into the durable reference outbox', async (t) => {
  const { client, documents } = await createContext();
  t.after(() => client.close());
  const guard = referenceCaptureGuard(SYNC_ORIGIN.remote);

  await documents.commitBatch({
    label: 'remote-reference-apply',
    beforeStatements: guard.beforeStatements,
    operations: [{
      type: 'put',
      store: 'todos',
      record: {
        UUID: 'remote-todo',
        parent: 'player-1',
        name: 'From another device',
        syncUpdatedAt: FIXED.toISOString(),
      },
    }],
    afterStatements: guard.afterStatements,
  });

  assert.equal(await client.query({
    sql: 'SELECT COUNT(*) FROM sync_reference_outbox',
    result: 'value',
  }), 0);

  await documents.put('todos', {
    UUID: 'local-todo',
    parent: 'player-1',
    name: 'Local edit',
    syncUpdatedAt: FIXED.toISOString(),
  });
  assert.equal(await client.query({
    sql: "SELECT COUNT(*) FROM sync_reference_outbox WHERE record_id='local-todo'",
    result: 'value',
  }), 1);
});

test('a configured device is registered once instead of once per sync pass', async (t) => {
  const { client } = await createContext();
  t.after(() => client.close());
  let registrations = 0;
  const runtime = new SyncRuntime({
    client,
    transport: {
      async registerDevice() { registrations += 1; return { registered: true }; },
      async push() { return []; },
    },
    now: () => FIXED,
    windowRef: null,
  });
  await runtime.initialize({ start: false });

  await runtime.synchronize({ reason: 'first' });
  await runtime.synchronize({ reason: 'second' });

  assert.equal(registrations, 1);
});

test('registration outages stay in-app for over one minute with one request and backoff', async (t) => {
  const { client } = await createContext();
  t.after(() => client.close());
  let virtualNow = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const settle = async () => {
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
  };
  const advanceTo = async (target) => {
    while (true) {
      await settle();
      const next = [...timers.entries()]
        .map(([id, timer]) => ({ id, ...timer }))
        .filter((timer) => timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      timers.delete(next.id);
      virtualNow = next.at;
      next.callback();
    }
    virtualNow = target;
    await settle();
  };
  const setTimeoutFn = (callback, delay) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, at: virtualNow + Math.max(0, Number(delay) || 0) });
    return id;
  };
  const clearTimeoutFn = (id) => timers.delete(id);

  let registrationCalls = 0;
  let activeRegistrations = 0;
  let maximumActiveRegistrations = 0;
  let reloads = 0;
  const profileState = {
    activePlayerUUID: 'profile-stays-selected',
    async commitAtomicMutation() { return { changed: false }; },
  };
  const runtime = new SyncRuntime({
    client,
    connection: profileState,
    transport: {
      registerDevice(_device, { signal } = {}) {
        registrationCalls += 1;
        activeRegistrations += 1;
        maximumActiveRegistrations = Math.max(maximumActiveRegistrations, activeRegistrations);
        return new Promise((_, reject) => {
          signal?.addEventListener?.('abort', () => {
            activeRegistrations -= 1;
            const error = new Error('registration aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      },
      async push() { return []; },
    },
    now: () => new Date(FIXED.getTime() + virtualNow),
    windowRef: {
      location: { reload() { reloads += 1; } },
      dispatchEvent() {},
    },
    setTimeoutFn,
    clearTimeoutFn,
    deviceRegistrationTimeoutMs: 10_000,
  });
  await runtime.initialize({ start: false });

  const firstSync = runtime.synchronize({ reason: 'server-unavailable' });
  await advanceTo(10_000);
  await assert.rejects(firstSync, (error) => (
    error?.code === 'sync-device-registration-timeout'
  ));
  assert.equal(runtime.getStatus().status, 'error');
  assert.equal(runtime.syncPromise, null);

  // Drive the background retry clock beyond one minute without sleeping. At
  // no point may a retry overlap, remount/reset application state, or reload.
  await advanceTo(65_000);
  assert.equal(maximumActiveRegistrations, 1);
  assert.equal(activeRegistrations, 0);
  assert.equal(registrationCalls, 5);
  assert.equal(runtime.getStatus().status, 'error');
  assert.equal(runtime.syncPromise, null);
  assert.equal(reloads, 0);
  assert.equal(profileState.activePlayerUUID, 'profile-stays-selected');
  assert.ok([...timers.values()].some(({ at }) => at > virtualNow));
  runtime.stop();
});

test('a sync nudge received during a pass schedules one follow-up pass', async (t) => {
  const { client } = await createContext();
  t.after(() => client.close());
  const scheduled = [];
  const runtime = new SyncRuntime({
    client,
    transport: { async push() { return []; } },
    now: () => FIXED,
    windowRef: null,
    setTimeoutFn: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutFn: () => undefined,
  });
  await runtime.initialize({ start: false });
  runtime.afterSynchronize = async () => {
    runtime.scheduleSync('write-during-sync');
    return null;
  };

  await runtime.synchronize({ reason: 'current-pass' });

  assert.equal(scheduled.length, 1);
  assert.equal(runtime.scheduledTimer, 1);
  runtime.cancelScheduledSync();
});

test('commit scheduling preserves live, prompt, and background urgency lanes', async (t) => {
  const { client } = await createContext();
  t.after(() => client.close());
  const scheduled = [];
  const cleared = [];
  const runtime = new SyncRuntime({
    client,
    transport: { async push() { return []; } },
    now: () => FIXED,
    windowRef: null,
    setTimeoutFn: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutFn: (timer) => { cleared.push(timer); },
  });
  await runtime.initialize({ start: false });

  runtime.databaseCommitted({ command: { label: 'delete-social-encounter-memories' } });
  assert.equal(scheduled.at(-1).delay, 15_000);
  await runtime.operationCommitted({ referenceTypes: ['task'], label: 'generic-put:todos' });
  assert.equal(scheduled.at(-1).delay, 750);
  assert.deepEqual(cleared, [1]);
  await runtime.operationCommitted({ referenceTypes: ['action-session'], label: 'action-session-start' });
  assert.equal(scheduled.at(-1).delay, 0);
  assert.deepEqual(cleared, [1, 2]);
  runtime.cancelScheduledSync();
});

test('checkpoint upload stays dirty when a newer SQLite generation lands in flight', async (t) => {
  const { client } = await createContext();
  t.after(() => client.close());
  let releaseUpload;
  let uploadStarted;
  const started = new Promise((resolve) => { uploadStarted = resolve; });
  const runtime = new SyncRuntime({
    client,
    connection: {
      async commitAtomicMutation() { return { changed: false }; },
      async flushWrites() {},
      persistenceRuntime: {
        sqliteStorageAdapter: {
          async exportSnapshot() {
            return {
              byteArray: new Uint8Array([1, 2, 3]),
              quickCheck: 'ok',
              foreignKeyViolations: [],
            };
          },
        },
      },
    },
    transport: {
      async uploadDatabaseCheckpoint() {
        uploadStarted();
        return new Promise((resolve) => { releaseUpload = resolve; });
      },
    },
    now: () => FIXED,
    windowRef: null,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
  });
  await runtime.initialize({ start: false });
  runtime.setCheckpointPublishingEnabled(true);
  runtime.databaseCommitted();
  const upload = runtime.publishCloudCheckpoint({ force: true });
  await started;
  runtime.databaseCommitted();
  releaseUpload({ uploaded: true });
  await upload;

  assert.equal(runtime.checkpointDirty, true);
  assert.equal(runtime.checkpointGeneration, 2);
});

test('SyncRuntime retries interrupted uploads and settles accepted operations', async (t) => {
  const { client, documents } = await createContext();
  t.after(() => client.close());
  await commitTodo(documents, 'operation-1', 'Original');

  let shouldFail = true;
  const scheduled = [];
  const transport = {
    async push({ operations }) {
      if (shouldFail) {
        const error = new Error('network unavailable');
        error.code = 'offline';
        throw error;
      }
      return operations.map((operation, index) => ({
        operationId: operation.operationId,
        status: 'accepted',
        serverSequence: index + 10,
        acceptedAt: FIXED.toISOString(),
      }));
    },
  };
  const runtime = new SyncRuntime({
    client,
    transport,
    now: () => FIXED,
    setTimeoutFn: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutFn: () => undefined,
    windowRef: null,
  });
  await runtime.initialize({ start: false });

  await assert.rejects(runtime.synchronize(), /network unavailable/);
  const pending = await runtime.operations.get('operation-1');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.attemptCount, 1);
  assert.equal(pending.lastErrorCode, 'offline');
  assert.equal(runtime.getStatus().status, 'error');
  assert.equal(scheduled.length, 1);

  runtime.cancelScheduledSync();
  shouldFail = false;
  const result = await runtime.synchronize();
  assert.equal(result.uploaded, 1);
  const accepted = await runtime.operations.get('operation-1');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.serverSequence, 10);
  assert.equal(runtime.getStatus().status, 'pending');
  assert.equal(runtime.getStatus().referencePending, 1);
});

test('offline task create, edit, and complete replay once after reconnect', async (t) => {
  const { client, documents } = await createContext();
  t.after(() => client.close());
  const lifecycle = [
    ['mobile-create', 'createTask', { UUID: 'todo-mobile', parent: 'player-1', name: 'Offline task', syncVersion: 1 }],
    ['mobile-edit', 'updateTask', { UUID: 'todo-mobile', parent: 'player-1', name: 'Offline task edited', syncVersion: 2 }],
    ['mobile-complete', 'completeTask', { UUID: 'todo-mobile', parent: 'player-1', name: 'Offline task edited', completedAt: FIXED.toISOString(), syncVersion: 3 }],
  ];
  for (const [operationId, commandType, task] of lifecycle) {
    const context = normalizeSyncContext({
      origin: SYNC_ORIGIN.mobile,
      enqueueSync: true,
      operationId,
      ownerId: 'owner-1',
      playerId: 'player-1',
      workspaceId: 'workspace:default',
      deviceId: 'device-1',
      commandType,
      entityType: 'task',
      entityId: task.UUID,
      baseVersion: task.syncVersion - 1,
      payload: { task },
      occurredAt: FIXED,
    }, { now: FIXED });
    await documents.commitBatch({
      commandId: operationId,
      label: `offline-${commandType}`,
      operations: [{ type: 'put', store: 'todos', record: task }],
      additionalStatements: [buildSyncOutboxStatement(context)],
    });
  }
  assert.equal((await documents.get('todos', 'todo-mobile')).completedAt, FIXED.toISOString());
  assert.equal(await client.query({ sql: 'SELECT COUNT(*) FROM sync_operations', result: 'value' }), 3);

  let online = false;
  let pushCalls = 0;
  const runtime = new SyncRuntime({
    client,
    transport: {
      async push({ operations }) {
        pushCalls += 1;
        if (!online) {
          const error = new Error('offline');
          error.code = 'offline';
          throw error;
        }
        return operations.map((operation, index) => ({
          operationId: operation.operationId,
          status: 'accepted',
          serverSequence: 100 + index,
          acceptedAt: FIXED.toISOString(),
        }));
      },
    },
    now: () => FIXED,
    windowRef: null,
  });
  await runtime.initialize({ start: false });
  await assert.rejects(runtime.synchronize(), /offline/);
  assert.equal(await client.query({ sql: "SELECT COUNT(*) FROM sync_operations WHERE status='pending'", result: 'value' }), 3);

  online = true;
  const replay = await runtime.synchronize();
  assert.equal(replay.uploaded, 3);
  assert.equal(await client.query({ sql: "SELECT COUNT(*) FROM sync_operations WHERE status='accepted'", result: 'value' }), 3);
  const settled = await runtime.synchronize();
  assert.equal(settled.uploaded, 0);
  assert.equal(pushCalls, 2);

  const duplicate = await documents.commitBatch({
    commandId: 'mobile-complete',
    label: 'duplicate-mobile-complete',
    operations: [{ type: 'put', store: 'todos', record: { UUID: 'todo-mobile', name: 'Must not replace' } }],
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal((await documents.get('todos', 'todo-mobile')).name, 'Offline task edited');
});

test('successful sync automatically bounds old accepted outbox history', async (t) => {
  const { client, documents } = await createContext();
  t.after(() => client.close());
  const acknowledgements = [];
  for (let index = 0; index < 252; index += 1) {
    const operationId = `accepted-old-${String(index).padStart(3, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    await commitTodo(documents, operationId, `Historical ${index}`);
    acknowledgements.push({
      operationId,
      status: 'accepted',
      serverSequence: index + 1,
      acceptedAt: '2026-06-01T00:00:00.000Z',
    });
  }
  const runtime = new SyncRuntime({
    client,
    transport: { async push() { return []; } },
    now: () => FIXED,
    windowRef: null,
  });
  await runtime.initialize({ start: false });
  await runtime.operations.settle(acknowledgements);

  const result = await runtime.synchronize();
  assert.deepEqual(result.retention, { removed: 2 });
  assert.equal(await client.query({
    sql: "SELECT COUNT(*) FROM sync_operations WHERE status='accepted'",
    result: 'value',
  }), 250);
});

test('conflict acknowledgements preserve both payloads in the conflict inbox', async (t) => {
  const { client, documents } = await createContext();
  t.after(() => client.close());
  await commitTodo(documents, 'operation-conflict', 'Local title');

  const runtime = new SyncRuntime({
    client,
    transport: {
      async push({ operations }) {
        return operations.map((operation) => ({
          operationId: operation.operationId,
          status: 'conflict',
          serverSequence: 20,
          baseVersion: 1,
          serverVersion: 2,
          serverPayload: { name: 'Server title' },
        }));
      },
    },
    now: () => FIXED,
    windowRef: null,
  });
  await runtime.initialize({ start: false });
  await runtime.synchronize();

  const [conflict] = await runtime.conflicts.listOpen();
  assert.equal(conflict.operationId, 'operation-conflict');
  assert.deepEqual(conflict.localPayload, { name: 'Original' });
  assert.deepEqual(conflict.serverPayload, { name: 'Server title' });
  assert.equal(conflict.baseVersion, 1);
  assert.equal(conflict.serverVersion, 2);
  assert.equal(runtime.getStatus().status, 'conflict');
});
