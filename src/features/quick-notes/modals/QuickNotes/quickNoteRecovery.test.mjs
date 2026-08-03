import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuickNoteDraftStore } from './quickNoteRecovery.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('recovery drafts survive controller teardown and retain their durable base', () => {
  const storage = memoryStorage();
  const first = createQuickNoteDraftStore({ storage, scope: 'player-1' });
  first.save({
    noteId: 'note-1', content: 'unsaved', baseRevision: 4, baseHash: 'hash-4', editRevision: 8,
  });
  const reopened = createQuickNoteDraftStore({ storage, scope: 'player-1' });
  assert.deepEqual(reopened.get('note-1'), {
    noteId: 'note-1',
    content: 'unsaved',
    baseRevision: 4,
    baseHash: 'hash-4',
    editRevision: 8,
    updatedAt: reopened.get('note-1').updatedAt,
  });
});

test('an older save completion cannot clear a newer recovery draft', () => {
  const drafts = createQuickNoteDraftStore({ storage: memoryStorage() });
  drafts.save({ noteId: 'note-1', content: 'newer', editRevision: 3 });
  assert.equal(drafts.remove('note-1', { throughEditRevision: 2 }), false);
  assert.equal(drafts.get('note-1').content, 'newer');
  assert.equal(drafts.remove('note-1', { throughEditRevision: 3 }), true);
  assert.equal(drafts.get('note-1'), null);
});
