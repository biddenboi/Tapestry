import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '../../../domain/constants.js';
import SqliteProfileContextRepository from '../repositories/SqliteProfileContextRepository.js';
import ProfileContextProjectionService from './ProfileContextProjectionService.js';

const future = '2099-01-01T00:00:00.000Z';
const item = (UUID, parent, audience, text) => ({
  UUID,
  parent,
  type: 'chapter',
  text,
  source: 'manual',
  audience,
  sourceVisibility: audience,
  sensitivity: 'low',
  status: 'active',
  expiresAt: future,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
});

test('batch projection uses constant store reads and isolates selected recipients', async () => {
  let reads = 0;
  const stores = new Map([
    [STORES.profileContextItem, [
      item('a-selected', 'a', 'selected', 'Only viewer one'),
      item('a-cast', 'a', 'cast', 'Visible to cast'),
      item('b-fellows', 'b', 'fellows', 'Visible to Fellows'),
    ]],
    [STORES.profileContextRecipient, [{
      UUID: 'a-selected:viewer-1',
      parent: 'a',
      itemId: 'a-selected',
      recipientId: 'viewer-1',
    }]],
    [STORES.profileContextSuggestion, []],
    [STORES.profileContextPreference, []],
    [STORES.profileContextAudit, []],
  ]);
  const facade = {
    getAll: async (store) => { reads += 1; return stores.get(store) || []; },
    getPlayerStore: async (store, owner) => (stores.get(store) || []).filter((row) => row.parent === owner),
    add: async () => {},
  };
  const repository = new SqliteProfileContextRepository(facade);
  const service = new ProfileContextProjectionService({ repository });
  const projections = await service.getProjections({
    viewerId: 'viewer-1',
    subjects: [
      { subjectId: 'a', relationshipTier: 'friend' },
      { subjectId: 'b', relationshipTier: 'dynamic' },
      { subjectId: 'c', relationshipTier: 'dynamic' },
    ],
    viewerIGT: 100,
    revision: 1,
    now: new Date('2026-07-27T12:00:00.000Z'),
  });
  assert.equal(reads, 4);
  assert.deepEqual(projections.get('a').items.map((entry) => entry.text), ['Only viewer one', 'Visible to cast']);
  assert.deepEqual(projections.get('b').items.map((entry) => entry.text), ['Visible to Fellows']);
  assert.equal(projections.get('c').reason, 'no-shared-context');

  const viewerTwo = await service.getProjection({
    viewerId: 'viewer-2',
    subjectId: 'a',
    relationshipTier: 'friend',
    viewerIGT: 100,
    revision: 1,
    now: new Date('2026-07-27T12:00:00.000Z'),
  });
  assert.deepEqual(viewerTwo.items.map((entry) => entry.text), ['Visible to cast']);
});

