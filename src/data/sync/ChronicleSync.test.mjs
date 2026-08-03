import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '../../domain/constants.js';
import { buildRemoteChronicleMutation } from './ChronicleSync.js';

function facade(seed = {}) {
  const stores = new Map(Object.values(STORES).map((store) => [store, new Map()]));
  for (const [store, records] of Object.entries(seed)) {
    for (const record of records) stores.get(store).set(record.UUID, record);
  }
  return {
    async get(store, UUID) { return stores.get(store).get(UUID) || null; },
    async getAll(store) { return [...stores.get(store).values()]; },
  };
}

function entry(overrides = {}) {
  return {
    operationId: 'remote-op',
    commandType: 'updateChronicleEntry',
    serverSequence: 7,
    acceptedAt: '2026-08-02T12:00:00.000Z',
    result: { entity: { version: 2 } },
    payload: {
      journal: {
        UUID: 'entry-1', parent: 'owner', title: 'Remote', entry: 'Remote body',
        images: [], revisionContentHash: 'remote-hash', syncVersion: 2,
      },
      metadata: {
        UUID: 'entry-1', journalUUID: 'entry-1', parent: 'owner',
        entryKind: 'moment', currentRevisionNumber: 2,
      },
      access: { UUID: 'entry-1', journalUUID: 'entry-1', ownerUUID: 'owner' },
      revision: {
        UUID: 'entry-revision:entry-1:2', entryUUID: 'entry-1', revisionNumber: 2,
        baseRevisionNumber: 1, parent: 'owner', ownerUUID: 'owner', editorUUID: 'owner',
        title: 'Remote', subtitle: '', body: 'Remote body', images: [], entryKind: 'moment',
        contentHash: 'remote-hash', clientOperationId: 'remote-op',
      },
      receipt: { UUID: 'remote-op', operationId: 'remote-op', parent: 'owner' },
      baseContentHash: 'base-hash',
    },
    ...overrides,
  };
}

test('remote Chronicle continuation replaces the canonical entry without creating a conflict', async () => {
  const mutation = await buildRemoteChronicleMutation(entry(), facade({
    [STORES.journal]: [{ UUID: 'entry-1', parent: 'owner', entry: 'Base', revisionContentHash: 'base-hash' }],
    [STORES.chronicleEntryMetadata]: [{ UUID: 'entry-1', journalUUID: 'entry-1', currentRevisionNumber: 1 }],
    [STORES.chronicleEntryRevision]: [{
      UUID: 'entry-revision:entry-1:1', entryUUID: 'entry-1', revisionNumber: 1,
      contentHash: 'base-hash', body: 'Base',
    }],
  }));
  assert.equal(mutation.label, 'remote-updateChronicleEntry');
  assert.equal(mutation.puts.find(({ store }) => store === STORES.journal).record.entry, 'Remote body');
  assert.equal(mutation.puts.some(({ store }) => store === STORES.chronicleEntryConflict), false);
});

test('divergent Moment edits preserve the local body and the remote body as an unresolved revision', async () => {
  const mutation = await buildRemoteChronicleMutation(entry(), facade({
    [STORES.journal]: [{
      UUID: 'entry-1', parent: 'owner', title: 'Local', entry: 'Local body',
      revisionContentHash: 'local-hash', syncVersion: 2,
    }],
    [STORES.chronicleEntryMetadata]: [{
      UUID: 'entry-1', journalUUID: 'entry-1', entryKind: 'moment', currentRevisionNumber: 2,
    }],
    [STORES.chronicleEntryAccess]: [{ UUID: 'entry-1', journalUUID: 'entry-1', ownerUUID: 'owner' }],
    [STORES.chronicleEntryRevision]: [{
      UUID: 'entry-revision:entry-1:2', entryUUID: 'entry-1', revisionNumber: 2,
      contentHash: 'local-hash', title: 'Local', body: 'Local body', entryKind: 'moment',
    }],
  }));
  const journal = mutation.puts.find(({ store }) => store === STORES.journal).record;
  const remoteRevision = mutation.puts.find(({ store }) => store === STORES.chronicleEntryRevision).record;
  const conflict = mutation.puts.find(({ store }) => store === STORES.chronicleEntryConflict).record;
  assert.equal(journal.entry, 'Local body');
  assert.equal(remoteRevision.revisionNumber, 3);
  assert.equal(remoteRevision.body, 'Remote body');
  assert.equal(conflict.proposed.body, 'Local body');
  assert.equal(conflict.received.body, 'Remote body');
  assert.equal(conflict.resolvedAt, null);
});
