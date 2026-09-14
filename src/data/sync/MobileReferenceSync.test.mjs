import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMobileReferenceRecords,
  publishCurrentMobileResources,
} from './MobileReferenceSync.js';

const PLAYER = Object.freeze({ UUID: 'player-cloud', username: 'Cloud profile' });

function activeProfileConnection({
  activePlayerUUID = 'player-local',
  changedAt = '2026-08-03T12:00:00.000Z',
} = {}) {
  const applied = [];
  return {
    applied,
    getActivePlayerUUID: () => activePlayerUUID,
    getActivePlayerChangedAt: () => changedAt,
    get: async (_store, UUID) => (UUID === PLAYER.UUID ? PLAYER : null),
    setActivePlayerUUID: (...args) => applied.push(args),
    flushWrites: async () => undefined,
  };
}

test('mobile force restore cannot overwrite a newer local boundary selection', async () => {
  const connection = activeProfileConnection();
  const result = await applyMobileReferenceRecords(connection, [{
    recordType: 'active-profile-state',
    recordId: 'active',
    playerId: PLAYER.UUID,
    data: {
      UUID: 'active',
      activePlayerUUID: PLAYER.UUID,
      changedAt: '2026-08-03T11:00:00.000Z',
    },
    updatedAt: '2026-08-03T11:00:00.000Z',
  }], { forceActiveProfile: true });

  assert.equal(result.activeProfileApplied, 0);
  assert.deepEqual(connection.applied, []);
});

test('remote active profile application disables outgoing re-enqueue', async () => {
  const connection = activeProfileConnection({
    activePlayerUUID: null,
    changedAt: null,
  });
  const result = await applyMobileReferenceRecords(connection, [{
    recordType: 'active-profile-state',
    recordId: 'active',
    playerId: PLAYER.UUID,
    data: {
      UUID: 'active',
      activePlayerUUID: PLAYER.UUID,
      changedAt: '2026-08-03T13:00:00.000Z',
    },
    updatedAt: '2026-08-03T13:00:00.000Z',
  }], { forceActiveProfile: true });

  assert.equal(result.activeProfileApplied, 1);
  assert.deepEqual(connection.applied, [[PLAYER.UUID, {
    changedAt: '2026-08-03T13:00:00.000Z',
    enqueueSync: false,
  }]]);
});

test('a pending active-profile outbox record protects the local selection', async () => {
  const connection = activeProfileConnection({ activePlayerUUID: null, changedAt: null });
  const result = await applyMobileReferenceRecords(connection, [{
    recordType: 'active-profile-state',
    recordId: 'active',
    playerId: PLAYER.UUID,
    data: { UUID: 'active', activePlayerUUID: PLAYER.UUID },
    updatedAt: '2026-08-03T13:00:00.000Z',
  }], {
    forceActiveProfile: true,
    protectedRecordKeys: new Set(['active-profile-state:active']),
  });

  assert.equal(result.activeProfileApplied, 0);
  assert.deepEqual(connection.applied, []);
});

test('a clean restore selects a valid synchronized profile when selection state is absent', async () => {
  const applied = [];
  const connection = {
    getActivePlayerUUID: () => null,
    getActivePlayerChangedAt: () => null,
    get: async () => null,
    getAll: async () => [PLAYER],
    setActivePlayerUUID: (...args) => applied.push(args),
    flushWrites: async () => undefined,
  };
  const result = await applyMobileReferenceRecords(connection, [], {
    forceActiveProfile: true,
  });

  assert.equal(result.activeProfileApplied, 1);
  assert.equal(applied[0][0], PLAYER.UUID);
  assert.equal(applied[0][1].enqueueSync, false);
});

test('desktop routine sync publishes every resource referenced by profiles, catalog, and posts', async () => {
  const resources = new Map([
    ['avatar-1', { UUID: 'avatar-1', hash: 'a'.repeat(64), blob: new Blob(['avatar']) }],
    ['banner-1', { UUID: 'banner-1', hash: 'b'.repeat(64), blob: new Blob(['banner']) }],
    ['post-1', { UUID: 'post-1', hash: 'c'.repeat(64), blob: new Blob(['post']) }],
  ]);
  let published = [];
  const connection = {
    persistenceRuntime: {
      sqliteStorageAdapter: {
        documents: {
          getAll: async (store) => {
            if (store === 'players') return [{ UUID: 'player-1', profilePicture: { type: 'resource', resourceUUID: 'avatar-1' } }];
            if (store === 'shop') return [{ UUID: 'shop-1', banner: { type: 'resource', resourceUUID: 'banner-1' } }];
            if (store === 'journals') return [{ UUID: 'journal-1', images: [{ type: 'resource', resourceUUID: 'post-1' }] }];
            return [];
          },
        },
      },
    },
    get: async (_store, UUID) => resources.get(UUID) || null,
  };
  const result = await publishCurrentMobileResources(connection, {
    publishMobileResources: async (records) => {
      published = records;
      return { uploaded: records.length, registered: records.length };
    },
  });
  assert.deepEqual(published.map(({ UUID }) => UUID).sort(), ['avatar-1', 'banner-1', 'post-1']);
  assert.deepEqual(result, { uploaded: 3, registered: 3 });
});
