import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabaseSyncTransport } from './SupabaseSyncTransport.js';

test('push exposes command envelopes but never forwards a client owner id', async () => {
  let invocation = null;
  const client = {
    rpc: async (name, parameters) => {
      invocation = { name, parameters };
      return { data: [{ operationId: 'op-1', status: 'accepted' }], error: null };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
  const transport = new SupabaseSyncTransport({ client, ownerId: 'trusted-session-owner' });
  const result = await transport.push({ operations: [{
    operationId: 'op-1',
    ownerId: 'spoofed-owner',
    playerId: 'player-1',
    workspaceId: 'workspace:default',
    deviceId: 'device-1',
    deviceSequence: 3,
    commandType: 'updateTask',
    entityType: 'task',
    entityId: 'task-1',
    baseVersion: 2,
    payload: { name: 'Next' },
    occurredAt: '2026-08-02T12:00:00.000Z',
  }] });

  assert.equal(invocation.name, 'apply_sync_batch');
  assert.equal('ownerId' in invocation.parameters.p_operations[0], false);
  assert.equal(invocation.parameters.p_operations[0].deviceId, 'device-1');
  assert.equal(invocation.parameters.p_operations[0].workspaceId, 'workspace:default');
  assert.equal(invocation.parameters.p_operations[0].payload.workspaceId, 'workspace:default');
  assert.equal(result[0].status, 'accepted');
});

test('pull converts the SQL RPC shape to the runtime contract', async () => {
  const client = {
    rpc: async () => ({
      data: [{
        server_sequence: 9,
        operation_id: 'op-9',
        player_id: 'player-1',
        workspace_id: 'workspace:default',
        origin_device_id: 'phone',
        device_sequence: 4,
        command_type: 'recordRewardProvenance',
        entity_type: 'reward-provenance',
        entity_id: 'reward-1',
        base_version: null,
        payload: { UUID: 'reward-1' },
        occurred_at: '2026-08-02T12:00:00Z',
        status: 'accepted',
        accepted_at: '2026-08-02T12:00:01Z',
        result_json: { eventId: 'op-9' },
      }],
      error: null,
    }),
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
  const [entry] = await new SupabaseSyncTransport({ client, ownerId: 'owner' }).pull({ after: 8 });
  assert.equal(entry.serverSequence, 9);
  assert.equal(entry.commandType, 'recordRewardProvenance');
  assert.equal(entry.payload.UUID, 'reward-1');
  assert.equal(entry.originDeviceId, 'phone');
  assert.equal(entry.workspaceId, 'workspace:default');
});

test('routine commands use the narrow routine RPC without reordering adjacent operations', async () => {
  const calls = [];
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, ids: parameters.p_operations.map((operation) => operation.operationId) });
      return {
        data: parameters.p_operations.map((operation) => ({ operationId: operation.operationId, status: 'accepted' })),
        error: null,
      };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
  const operations = [
    { operationId: 'task-1', commandType: 'updateTask' },
    { operationId: 'routine-1', commandType: 'startRoutineRun' },
    { operationId: 'routine-2', commandType: 'completeRoutineStep' },
    { operationId: 'chronicle-1', commandType: 'createChronicleEntry' },
    { operationId: 'chronicle-2', commandType: 'changeChronicleAccess' },
    { operationId: 'match-1', commandType: 'createMatch' },
    { operationId: 'match-2', commandType: 'completeMatch' },
    { operationId: 'task-2', commandType: 'updateTask' },
  ].map((operation, index) => ({
    ...operation,
    deviceId: 'device', deviceSequence: index + 1, entityType: 'test', entityId: operation.operationId,
    payload: {}, occurredAt: '2026-08-02T12:00:00.000Z',
  }));
  const results = await new SupabaseSyncTransport({ client, ownerId: 'owner' }).push({ operations });
  assert.deepEqual(calls, [
    { name: 'apply_sync_batch', ids: ['task-1'] },
    { name: 'apply_routine_sync_batch', ids: ['routine-1', 'routine-2'] },
    { name: 'apply_chronicle_sync_batch', ids: ['chronicle-1', 'chronicle-2'] },
    { name: 'apply_match_sync_batch', ids: ['match-1', 'match-2'] },
    { name: 'apply_sync_batch', ids: ['task-2'] },
  ]);
  assert.deepEqual(results.map(({ operationId }) => operationId), operations.map(({ operationId }) => operationId));
});

test('mobile reference reads can request the lightweight record subset', async () => {
  const calls = [];
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: [], error: null };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
  const transport = new SupabaseSyncTransport({ client, ownerId: 'owner' });
  await transport.getMobileReferenceRecords(['profile', 'goal', 'profile']);
  await transport.getMobileReferenceRecords();
  assert.deepEqual(calls, [
    {
      name: 'get_mobile_reference_records_by_type',
      parameters: { p_record_types: ['profile', 'goal'] },
    },
    { name: 'get_mobile_reference_records', parameters: undefined },
  ]);
});

test('identical concurrent working-set publications share one server session', async () => {
  const calls = [];
  const client = {
    rpc: async (name) => {
      calls.push(name);
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (name === 'begin_mobile_reference_publish') return { data: 'token-1', error: null };
      if (name === 'merge_mobile_reference_publish') return { data: { merged: 1 }, error: null };
      if (name === 'finalize_mobile_reference_publish') return { data: { pruned: 0 }, error: null };
      return { data: null, error: null };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
  const transport = new SupabaseSyncTransport({ client, ownerId: 'owner' });
  const records = [{ recordType: 'profile', recordId: 'p1', updatedAt: '2026-08-02T12:00:00.000Z' }];
  const [first, second] = await Promise.all([
    transport.replaceMobileReferenceRecords(records),
    transport.replaceMobileReferenceRecords(records),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls.filter((name) => name === 'begin_mobile_reference_publish').length, 1);
  assert.equal(calls.filter((name) => name === 'finalize_mobile_reference_publish').length, 1);
});

test('inactive working-set publication restarts once with a new token', async () => {
  const calls = [];
  let begins = 0;
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, token: parameters?.p_publish_token || null });
      if (name === 'begin_mobile_reference_publish') {
        begins += 1;
        return { data: `token-${begins}`, error: null };
      }
      if (name === 'merge_mobile_reference_publish' && parameters.p_publish_token === 'token-1') {
        return { data: null, error: { message: 'The mobile working-set publish session is no longer active.' } };
      }
      if (name === 'merge_mobile_reference_publish') return { data: { merged: 1 }, error: null };
      if (name === 'finalize_mobile_reference_publish') return { data: { pruned: 2 }, error: null };
      return { data: null, error: null };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
  const result = await new SupabaseSyncTransport({ client, ownerId: 'owner' })
    .replaceMobileReferenceRecords([{ recordType: 'task', recordId: 't1', updatedAt: '2026-08-02T12:00:00.000Z' }]);
  assert.equal(begins, 2);
  assert.equal(result.merged, 1);
  assert.equal(result.pruned, 2);
  assert.equal(calls.filter(({ name }) => name === 'finalize_mobile_reference_publish').length, 1);
});


test('database checkpoints round-trip through the account-scoped latest pointer', async () => {
  const objects = new Map();
  const storage = {
    async upload(path, value) {
      objects.set(path, value instanceof Blob ? value : new Blob([value]));
      return { error: null };
    },
    async download(path) {
      const data = objects.get(path);
      return data
        ? { data, error: null }
        : { data: null, error: { statusCode: '404', message: 'not found' } };
    },
  };
  const client = {
    rpc: async () => ({ data: null, error: null }),
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    storage: { from() { return storage; } },
  };
  const transport = new SupabaseSyncTransport({ client, ownerId: 'owner-1' });
  const bytes = new Uint8Array([83, 81, 76, 105, 116, 101]);
  const uploaded = await transport.uploadDatabaseCheckpoint({
    bytes,
    deviceId: 'desktop/one',
    createdAt: '2026-08-03T01:00:00.000Z',
  });
  assert.equal(uploaded.uploaded, true);
  assert.equal(uploaded.latestManifestPath, 'owner-1/database-checkpoints/latest.json');
  assert.ok(objects.has('owner-1/database-checkpoints/devices/desktop%2Fone/tapestry.sqlite'));

  const downloaded = await transport.downloadDatabaseCheckpoint();
  assert.equal(downloaded.found, true);
  assert.deepEqual([...downloaded.bytes], [...bytes]);
  assert.equal(downloaded.manifest.deviceId, 'desktop/one');
  assert.equal(downloaded.manifest.createdAt, '2026-08-03T01:00:00.000Z');
});

test('a missing cloud checkpoint is an empty-account state, not a transport failure', async () => {
  const client = {
    rpc: async () => ({ data: null, error: null }),
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    storage: {
      from() {
        return {
          async download() {
            return { data: null, error: { statusCode: '404', message: 'Object not found' } };
          },
        };
      },
    },
  };
  const result = await new SupabaseSyncTransport({ client, ownerId: 'owner' })
    .downloadDatabaseCheckpoint();
  assert.deepEqual(result, { found: false, reason: 'checkpoint-not-found' });
});
