import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyProtectedNoteMutation,
  buildProtectedNoteMutation,
  isNoteConflict,
  isNoteTombstone,
  normalizeNoteRecord,
  noteContentHash,
  noteOperationResult,
  reconcileProtectedNotes,
} from './noteDurability.js';

const clone = (value) => structuredClone(value);
const at = (minute) => `2026-07-12T12:${String(minute).padStart(2, '0')}:00.000Z`;

function canonicalNote(content = 'base') {
  return normalizeNoteRecord({
    UUID: 'note-1', content, createdAt: at(0), updatedAt: at(0),
  });
}

function updateMutation(current, content, operationId, minute = 1) {
  return buildProtectedNoteMutation({
    action: 'update',
    current,
    noteUUID: current.UUID,
    content,
    expectedRevision: current.revision,
    expectedHash: current.contentHash,
    operationId,
    now: at(minute),
  });
}

test('notes normalize deterministically to revision one and a content hash', () => {
  const first = canonicalNote('canonical text');
  const second = canonicalNote('canonical text');
  assert.equal(first.revision, 1);
  assert.equal(first.contentHash, noteContentHash('canonical text'));
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.operationReceipts, []);
});

test('an older autosave completing after a newer write cannot revert canonical text', () => {
  const base = canonicalNote();
  const older = updateMutation(base, 'older autosave', 'operation-older', 1);
  const newer = updateMutation(base, 'newer edit', 'operation-newer', 2);
  const store = new Map([[base.UUID, base]]);

  assert.equal(applyProtectedNoteMutation(store, newer, { clone }).status, 'applied');
  assert.equal(applyProtectedNoteMutation(store, older, { clone }).status, 'conflict');
  assert.equal(store.get(base.UUID).content, 'newer edit');
  assert.equal(store.get(base.UUID).revision, 2);
  assert.equal([...store.values()].filter(isNoteConflict)[0].content, 'older autosave');
});

test('duplicate operation replay is idempotent and does not add a revision', () => {
  const base = canonicalNote();
  const mutation = updateMutation(base, 'saved once', 'operation-1');
  const store = new Map([[base.UUID, base]]);
  applyProtectedNoteMutation(store, mutation, { clone });
  const replay = applyProtectedNoteMutation(store, mutation, { clone });
  assert.equal(replay.idempotent, true);
  assert.equal(store.get(base.UUID).revision, 2);
  assert.equal(noteOperationResult([...store.values()], 'operation-1').status, 'applied');
});

test('delete creates a monotonic tombstone and delayed autosave cannot resurrect it', () => {
  const base = canonicalNote();
  const delayedSave = updateMutation(base, 'delayed text', 'operation-save', 2);
  const deletion = buildProtectedNoteMutation({
    action: 'delete',
    current: base,
    noteUUID: base.UUID,
    expectedRevision: base.revision,
    expectedHash: base.contentHash,
    operationId: 'operation-delete',
    now: at(1),
  });
  const store = new Map([[base.UUID, base]]);
  assert.equal(applyProtectedNoteMutation(store, deletion, { clone }).status, 'deleted');
  assert.equal(isNoteTombstone(store.get(base.UUID)), true);
  assert.equal(store.get(base.UUID).revision, 2);
  assert.equal(applyProtectedNoteMutation(store, delayedSave, { clone }).status, 'conflict');
  assert.equal(isNoteTombstone(store.get(base.UUID)), true);
});

test('same revision with a different hash is quarantined instead of selected by timestamp', () => {
  const base = canonicalNote();
  const local = updateMutation(base, 'local', 'local-operation', 1);
  const remote = normalizeNoteRecord({ ...base, content: 'remote at revision one' });
  const store = new Map([[base.UUID, remote]]);
  const result = applyProtectedNoteMutation(store, local, { clone });
  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.conflictReason, 'same-revision-different-hash');
  assert.equal(store.get(base.UUID).content, 'remote at revision one');
});

test('import reconciliation keeps the greater revision and exposes rejected text', () => {
  const base = canonicalNote();
  const currentStore = new Map([[base.UUID, base]]);
  const revision2Mutation = updateMutation(base, 'current revision two', 'operation-2', 2);
  applyProtectedNoteMutation(currentStore, revision2Mutation, { clone });
  const revision2 = currentStore.get(base.UUID);
  const revision3Mutation = updateMutation(revision2, 'current revision three', 'operation-3', 3);
  applyProtectedNoteMutation(currentStore, revision3Mutation, { clone });

  const reconciled = reconcileProtectedNotes({
    current: [...currentStore.values()],
    incoming: [revision2],
    source: 'restore',
  });
  const canonical = reconciled.find((row) => row.UUID === base.UUID);
  assert.equal(canonical.content, 'current revision three');
  assert.equal(canonical.revision, 3);
  assert.equal(reconciled.some((row) => isNoteConflict(row) && row.content === 'current revision two'), true);
});

test('an explicitly present note snapshot is authoritative about which note IDs exist', () => {
  const retained = canonicalNote('retained');
  const removed = normalizeNoteRecord({
    UUID: 'note-2',
    content: 'removed externally',
    createdAt: at(0),
    updatedAt: at(0),
  });

  const reconciled = reconcileProtectedNotes({
    current: [retained, removed],
    incoming: [retained],
    source: 'restore',
    authoritativeMembership: true,
  });

  assert.equal(reconciled.some((row) => row.UUID === retained.UUID), true);
  assert.equal(reconciled.some((row) => row.UUID === removed.UUID), false);
});

test('an unavailable note snapshot is non-destructive', () => {
  const current = canonicalNote('keep when the source is unavailable');
  const reconciled = reconcileProtectedNotes({
    current: [current],
    incoming: [],
    source: 'unavailable-source',
  });

  assert.equal(reconciled.find((row) => row.UUID === current.UUID)?.content, current.content);
});
