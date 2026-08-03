import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '../../../domain/constants.js';
import ChronicleRevisionService, { ChronicleRevisionConflictError } from './ChronicleRevisionService.js';
import ChronicleCollaborationService from './ChronicleCollaborationService.js';

function memoryFacade() {
  const stores = new Map(Object.values(STORES).map((store) => [store, new Map()]));
  const commits = [];
  return {
    stores,
    commits,
    async get(store, UUID) { return stores.get(store).get(UUID) || null; },
    async getAll(store) { return [...stores.get(store).values()]; },
    async add(store, record) { stores.get(store).set(record.UUID, structuredClone(record)); },
    createSyncCommandContext(input) { return { ...input, ownerId: 'owner-account', deviceId: 'device-1' }; },
    async commitAtomicMutation(command) {
      const { puts = [], deletes = [] } = command;
      commits.push(structuredClone(command));
      for (const { store, record } of puts) stores.get(store).set(record.UUID, structuredClone(record));
      for (const { store, UUID } of deletes) stores.get(store).delete(UUID);
      return { changed: true };
    },
  };
}

function command(overrides = {}) {
  return {
    actorUUID: 'owner',
    journal: {
      UUID: 'entry-1', parent: 'owner', title: 'Title', entry: 'Body', images: [], createdAt: '2026-07-28T00:00:00.000Z',
    },
    metadata: {
      UUID: 'entry-1', journalUUID: 'entry-1', parent: 'owner', playerUUID: 'owner',
      entryKind: 'entry', lifecycleState: 'published', visibility: 'private',
      occurrenceAt: '2026-07-28T00:00:00.000Z', publishedAt: '2026-07-28T00:00:00.000Z', subtitle: '',
    },
    access: {
      UUID: 'entry-1', journalUUID: 'entry-1', ownerUUID: 'owner', visibility: 'private',
      editPolicy: 'owner', collaborationState: 'local', authorityScope: 'local', authorityRevision: 1,
    },
    expectedRevisionNumber: 0,
    clientOperationId: 'create-entry-1',
    ...overrides,
  };
}

test('canonical Entry saves create one immutable revision and one idempotent receipt', async () => {
  const facade = memoryFacade();
  const service = new ChronicleRevisionService(facade);
  const first = await service.saveContent(command());
  const replay = await service.saveContent(command());
  assert.equal(first.revision.revisionNumber, 1);
  assert.equal(first.revision.contentHash.length, 64);
  assert.equal(replay.idempotent, true);
  assert.equal((await facade.getAll(STORES.chronicleEntryRevision)).length, 1);
  assert.equal((await facade.getAll(STORES.chronicleEntryOperationReceipt)).length, 1);
  assert.equal((await facade.get(STORES.journal, 'entry-1')).revisionContentHash, first.revision.contentHash);
  assert.equal(facade.commits[0].sync.commandType, 'createChronicleEntry');
  assert.equal(facade.commits[0].sync.baseVersion, 0);
  assert.equal(facade.commits[0].sync.payload.baseContentHash, null);
});

test('stale Entry saves retain proposed text as a conflict instead of overwriting', async () => {
  const facade = memoryFacade();
  const service = new ChronicleRevisionService(facade);
  await service.saveContent(command());
  await assert.rejects(service.saveContent(command({
    expectedRevisionNumber: 0,
    clientOperationId: 'stale-entry-1',
    journal: { ...command().journal, entry: 'Stale proposed body' },
  })), ChronicleRevisionConflictError);
  assert.equal((await facade.getAll(STORES.chronicleEntryRevision)).length, 1);
  assert.equal((await facade.getAll(STORES.chronicleEntryConflict))[0].proposed.body, 'Stale proposed body');
});

test('Global Entries are edited locally by another profile with attributed revisions', async () => {
  const facade = memoryFacade();
  const collaboration = new ChronicleCollaborationService(facade);
  const created = await collaboration.saveLocalContent(command({
    metadata: { ...command().metadata, visibility: 'global' },
    access: {
      ...command().access,
      visibility: 'global',
      editPolicy: 'any_authenticated',
      collaborationState: 'unavailable',
      authorityScope: 'shared',
    },
  }));
  const edited = await collaboration.saveLocalContent(command({
    actorUUID: 'later-profile',
    journal: { ...created.journal, entry: 'Edited from a later profile' },
    metadata: created.metadata,
    access: created.access,
    expectedRevisionNumber: 1,
    clientOperationId: 'edit-entry-1-later-profile',
  }));
  assert.equal(edited.revision.revisionNumber, 2);
  assert.equal(edited.revision.editorUUID, 'later-profile');
  assert.equal(edited.access.ownerUUID, 'owner');
  assert.equal(edited.access.editPolicy, 'any_profile');
  assert.equal(edited.access.collaborationState, 'local');
  assert.equal((await facade.getAll(STORES.chronicleEntryRevision)).length, 2);
});
