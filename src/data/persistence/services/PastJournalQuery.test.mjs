import test from 'node:test';
import assert from 'node:assert/strict';
import ChronicleQueryService from './ChronicleQueryService.js';

test('random feed candidates exclude drafts, deleted, future and another owner’s private journals', async () => {
  const past = '2026-01-01T12:00:00Z';
  const journals = [
    { UUID: 'own', parent: 'me', visibility: 'hidden', createdAt: past },
    { UUID: 'shared', parent: 'friend', visibility: 'visible', createdAt: past },
    { UUID: 'private', parent: 'other', visibility: 'hidden', createdAt: past },
    { UUID: 'draft', parent: 'me', visibility: 'draft', createdAt: past },
    { UUID: 'deleted', parent: 'me', deletedAt: past, createdAt: past },
    { UUID: 'future', parent: 'me', createdAt: '2027-01-01T12:00:00Z' },
    { UUID: 'future-igt', parent: 'me', createdAt: past, inGameTimestamp: 1000 },
  ];
  const db = {
    getAll: async (store) => store === 'journals' ? journals : [],
    getAllThroughIGT: async (_store, boundary) => journals.filter((journal) => (journal.inGameTimestamp || 0) <= boundary),
  };
  const result = await new ChronicleQueryService(db).pastJournals({
    viewerUUID: 'me', viewerIGT: 100, now: Date.parse('2026-10-12T12:00:00Z'),
  });
  assert.deepEqual(result.map((journal) => journal.UUID).sort(), ['own', 'shared']);
  assert.deepEqual(await new ChronicleQueryService(db).pastJournals(), []);
});
