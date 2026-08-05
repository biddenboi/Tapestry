import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requestLiveReferenceSync,
  synchronizeReferenceTypes,
} from './ReferenceSyncLanes.js';

test('a live mutation arriving during a pull receives one immediate follow-up pass', async () => {
  let releaseFirst;
  const firstPass = new Promise((resolve) => { releaseFirst = resolve; });
  let flushes = 0;
  const runtime = {
    transport: {
      async getMobileReferenceChanges() { return []; },
    },
    async ensureDeviceRegistered() {},
    async flushReferenceOutbox() {
      flushes += 1;
      if (flushes === 1) await firstPass;
      return { uploaded: 0 };
    },
    async reconcileReferenceOutbox() {
      return { localWins: new Set(), discarded: 0 };
    },
    cursors: {
      async get() { return { serverSequence: 0 }; },
      async advance(_stream, serverSequence) { return { serverSequence }; },
    },
  };
  const databaseConnection = {
    syncRuntime: runtime,
    async flushSyncProjections() {},
  };

  const periodic = requestLiveReferenceSync(databaseConnection, 'periodic-pull');
  await Promise.resolve();
  const mutation = requestLiveReferenceSync(databaseConnection, 'match-forfeit');
  releaseFirst();
  await Promise.all([periodic, mutation]);

  assert.equal(flushes, 2);
});

test('periodic observers do not perpetually extend an active live pass', async () => {
  let releaseFirst;
  const firstPass = new Promise((resolve) => { releaseFirst = resolve; });
  let flushes = 0;
  const runtime = {
    transport: { async getMobileReferenceChanges() { return []; } },
    async ensureDeviceRegistered() {},
    async flushReferenceOutbox() {
      flushes += 1;
      if (flushes === 1) await firstPass;
      return { uploaded: 0 };
    },
    async reconcileReferenceOutbox() {
      return { localWins: new Set(), discarded: 0 };
    },
    cursors: {
      async get() { return { serverSequence: 0 }; },
      async advance(_stream, serverSequence) { return { serverSequence }; },
    },
  };
  const databaseConnection = {
    syncRuntime: runtime,
    async flushSyncProjections() {},
  };

  const first = requestLiveReferenceSync(databaseConnection, 'visible-live-state');
  await Promise.resolve();
  const observer = requestLiveReferenceSync(databaseConnection, 'visible-live-state');
  releaseFirst();
  await Promise.all([first, observer]);

  assert.equal(flushes, 1);
});

test('desktop publishes referenced resource bytes before its profile row', async () => {
  const order = [];
  const runtime = {
    checkpointPublishingEnabled: true,
    transport: {
      async publishMobileResources(resources) {
        order.push(`resources:${resources.map((resource) => resource.UUID).join(',')}`);
        return { uploaded: resources.length, registered: resources.length };
      },
      async getMobileReferenceChanges() { return []; },
    },
    async ensureDeviceRegistered() {},
    async flushReferenceOutbox() {
      order.push('profile-row');
      return { uploaded: 1 };
    },
    async reconcileReferenceOutbox() {
      return { localWins: new Set(), discarded: 0 };
    },
    cursors: {
      async get() { return { serverSequence: 0 }; },
      async advance(_stream, serverSequence) { return { serverSequence }; },
    },
  };
  const databaseConnection = {
    syncRuntime: runtime,
    async getAll(store) {
      if (store === 'players') {
        return [{
          UUID: 'profile-1',
          profilePicture: { type: 'resource', resourceUUID: 'avatar-1' },
        }];
      }
      return [];
    },
    async get(store, UUID) {
      return store === 'resources' && UUID === 'avatar-1'
        ? { UUID, mimeType: 'image/png', data: 'avatar-bytes' }
        : null;
    },
    async flushSyncProjections() {},
  };

  await synchronizeReferenceTypes(databaseConnection, {
    recordTypes: ['profile'],
    reason: 'avatar-ordering-test',
  });

  assert.deepEqual(order, ['resources:avatar-1', 'profile-row']);
});
