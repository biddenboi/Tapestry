import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '../../domain/constants.js';
import {
  assertSharedSyncStore,
  classifySyncStore,
  stripDerivedSyncFields,
  SYNC_DATA_CLASS,
} from './SyncDataPolicy.js';

test('every canonical store has one explicit phase-0 sync classification', () => {
  for (const store of Object.values(STORES)) {
    assert.ok(Object.values(SYNC_DATA_CLASS).includes(classifySyncStore(store)), store);
  }
});

test('device-local and derived stores cannot be added to live row sync', () => {
  assert.throws(() => assertSharedSyncStore(STORES.appSetting), (error) => (
    error?.code === 'sync-store-not-shared'
  ));
  assert.throws(() => assertSharedSyncStore(STORES.derivedCache), (error) => (
    error?.code === 'sync-store-not-shared'
  ));
  assert.equal(assertSharedSyncStore(STORES.todo), SYNC_DATA_CLASS.shared);
  assert.equal(assertSharedSyncStore(STORES.resource), SYNC_DATA_CLASS.attachment);
});

test('task sync payloads omit device-local and recomputable presentation fields', () => {
  const cleaned = stripDerivedSyncFields('todos', {
    UUID: 'todo-1',
    name: 'Write section',
    dueDate: '2026-08-03T09:00:00.000Z',
    dueDateObj: new Date('2026-08-03T09:00:00.000Z'),
    isOverdue: true,
    recommendation: { score: 10 },
    presencePaused: true,
  });
  assert.deepEqual(cleaned, {
    UUID: 'todo-1',
    name: 'Write section',
    dueDate: '2026-08-03T09:00:00.000Z',
  });
});
