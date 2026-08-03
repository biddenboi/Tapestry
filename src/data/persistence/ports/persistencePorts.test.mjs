import assert from 'node:assert/strict';
import test from 'node:test';

import StorageAdapter from './StorageAdapter.js';
import JournalStore from './JournalStore.js';
import ResourceStore from './ResourceStore.js';

test('storage adapter exposes one backend-neutral CRUD and transaction contract', async () => {
  const calls = [];
  const adapter = new StorageAdapter({
    get: (...args) => calls.push(['get', ...args]),
    getAll: (...args) => calls.push(['getAll', ...args]),
    put: (...args) => calls.push(['put', ...args]),
    remove: (...args) => calls.push(['remove', ...args]),
    clear: (...args) => calls.push(['clear', ...args]),
    transaction: (...args) => calls.push(['transaction', ...args]),
  });
  adapter.get('notes', 'n1');
  adapter.transaction('work');
  assert.deepEqual(calls, [['get', 'notes', 'n1'], ['transaction', 'work', undefined]]);
});

test('journal and resource contracts reject incomplete implementations', () => {
  assert.throws(() => new JournalStore({}), /requires a read implementation/);
  assert.throws(() => new ResourceStore({}), /requires a read implementation/);
});
