import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '../../../domain/constants.js';
import ChronicleSchema40ReconciliationService from './ChronicleSchema40ReconciliationService.js';

function sparseFacade() {
  const stores = new Map(Object.values(STORES).map((store) => [store, new Map()]));
  stores.get(STORES.journal).set('j1', {
    UUID: 'j1', parent: 'p1', title: 'Document only', entry: 'Preserved body', images: [], createdAt: '2026-01-01T00:00:00.000Z',
  });
  stores.get(STORES.chronicleEntryMetadata).set('j1', {
    UUID: 'j1', journalUUID: 'j1', parent: 'p1', playerUUID: 'p1', entryKind: 'entry',
    lifecycleState: 'published', visibility: 'fellows', occurrenceAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  return {
    stores,
    async getAll(store) { return [...stores.get(store).values()]; },
    async commitAtomicMutation({ puts = [] }) {
      for (const { store, record } of puts) stores.get(store).set(record.UUID, structuredClone(record));
    },
  };
}

test('schema 40 reconciliation backfills sparse canonical document Entries once', async () => {
  const facade = sparseFacade();
  const service = new ChronicleSchema40ReconciliationService(facade);
  const first = await service.reconcile();
  const second = await service.reconcile();
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(facade.stores.get(STORES.chronicleEntryAccess).size, 1);
  assert.equal(facade.stores.get(STORES.chronicleEntryRevision).size, 1);
  assert.equal(facade.stores.get(STORES.chronicleEntryOperationReceipt).size, 1);
  const revision = [...facade.stores.get(STORES.chronicleEntryRevision).values()][0];
  assert.equal(revision.body, 'Preserved body');
  assert.equal(facade.stores.get(STORES.journal).get('j1').revisionContentHash, revision.contentHash);
});

test('schema 40 reconciliation promotes a pre-Chronicle Journal without metadata', async () => {
  const facade = sparseFacade();
  facade.stores.get(STORES.chronicleEntryMetadata).clear();
  const result = await new ChronicleSchema40ReconciliationService(facade).reconcile();
  assert.equal(result.entryCount, 1);
  assert.equal(facade.stores.get(STORES.chronicleEntryMetadata).get('j1').visibility, 'fellows');
  assert.equal(facade.stores.get(STORES.chronicleEntryAccess).get('j1').editPolicy, 'owner');
  assert.equal(facade.stores.get(STORES.chronicleEntryRevision).size, 1);
});
