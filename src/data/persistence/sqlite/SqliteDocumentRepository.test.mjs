import assert from 'node:assert/strict';
import test from 'node:test';
import StorageAdapter from '../ports/StorageAdapter.js';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import { SQLITE_DOCUMENT_TABLES } from './documentStores.js';

function createMapAdapter() {
  const stores = new Map();
  const map = (store) => {
    if (!stores.has(store)) stores.set(store, new Map());
    return stores.get(store);
  };
  return new StorageAdapter({
    get: async (store, id) => structuredClone(map(store).get(id) || null),
    getAll: async (store) => [...map(store).values()].map((record) => structuredClone(record)),
    put: async (store, record) => { map(store).set(record.UUID, structuredClone(record)); return record.UUID; },
    remove: async (store, id) => map(store).delete(id),
    clear: async (store) => { const count = map(store).size; map(store).clear(); return count; },
    range: async (store, { field, lower, upper, direction = 'asc', limit = 1000 }) => (
      [...map(store).values()]
        .filter((row) => (lower == null || row[field] >= lower) && (upper == null || row[field] <= upper))
        .sort((a, b) => {
          const compared = a[field] === b[field] ? a.UUID.localeCompare(b.UUID) : (a[field] < b[field] ? -1 : 1);
          return direction === 'desc' ? -compared : compared;
        })
        .slice(0, limit)
        .map((record) => structuredClone(record))
    ),
    transaction: async (value) => value,
  });
}

async function createSqliteAdapter() {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'test' });
  const repository = new SqliteDocumentRepository(client);
  return {
    client,
    adapter: new StorageAdapter({
      get: (...args) => repository.get(...args),
      getAll: (...args) => repository.getAll(...args),
      put: (...args) => repository.put(...args),
      remove: (...args) => repository.remove(...args),
      clear: (...args) => repository.clear(...args),
      range: (...args) => repository.range(...args),
      transaction: (...args) => client.executeAtomic(...args),
    }),
  };
}

const fixtures = [
  { UUID: 'task-2', parent: 'player-a', name: 'Second', inGameTimestamp: 20, createdAt: '2026-01-02T00:00:00.000Z' },
  { UUID: 'task-1', parent: 'player-a', name: 'First', inGameTimestamp: 10, createdAt: '2026-01-01T00:00:00.000Z' },
  { UUID: 'task-3', parent: 'player-b', name: 'Third', inGameTimestamp: 30, createdAt: '2026-01-03T00:00:00.000Z' },
];

test('Map and SQLite document adapters return equivalent CRUD and ranges', async (t) => {
  const memory = createMapAdapter();
  const { client, adapter: sqlite } = await createSqliteAdapter();
  t.after(() => client.close());
  for (const fixture of fixtures) {
    assert.equal(await memory.put('tasks', fixture), fixture.UUID);
    assert.equal(await sqlite.put('tasks', fixture, { operationId: `put:${fixture.UUID}` }), fixture.UUID);
  }
  assert.deepEqual(await sqlite.get('tasks', 'task-2'), await memory.get('tasks', 'task-2'));
  assert.deepEqual(await sqlite.getAll('tasks'), await memory.getAll('tasks'));
  assert.deepEqual(
    await sqlite.range('tasks', { field: 'inGameTimestamp', lower: 15, upper: 30 }),
    await memory.range('tasks', { field: 'inGameTimestamp', lower: 15, upper: 30 }),
  );
  assert.equal(await sqlite.remove('tasks', 'task-2', { operationId: 'remove:task-2' }), true);
  assert.equal(await memory.remove('tasks', 'task-2'), true);
  assert.deepEqual(await sqlite.getAll('tasks'), await memory.getAll('tasks'));
  assert.equal(await sqlite.clear('tasks', { operationId: 'clear:tasks' }), 2);
  assert.equal(await memory.clear('tasks'), 2);
  assert.deepEqual(await sqlite.getAll('tasks'), []);
});

test('document tables are explicit per store rather than one EAV table', async (t) => {
  const { client } = await createSqliteAdapter();
  t.after(() => client.close());
  const tables = await client.query({
    sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'document_%' ORDER BY name",
    result: 'all',
  });
  assert.equal(tables.length, Object.keys(SQLITE_DOCUMENT_TABLES).length + 2);
  assert.ok(tables.some(({ name }) => name === 'document_tasks'));
  assert.ok(tables.some(({ name }) => name === 'document_players'));
  assert.ok(tables.some(({ name }) => name === 'document_resource_payloads'));
  assert.ok(tables.some(({ name }) => name === 'document_resource_payload_refs'));
  assert.ok(tables.some(({ name }) => name === 'document_goal_milestones'));
  assert.ok(tables.some(({ name }) => name === 'document_action_sessions'));
  assert.ok(tables.some(({ name }) => name === 'document_reward_provenance'));
  assert.ok(tables.some(({ name }) => name === 'document_profile_context_items'));
  assert.ok(tables.some(({ name }) => name === 'document_profile_context_recipients'));
  assert.ok(tables.some(({ name }) => name === 'document_task_plan_receipts'));
  assert.ok(tables.some(({ name }) => name === 'document_next_move_decisions'));
});

test('compact document batches commit all affected rows or none', async (t) => {
  const { client } = await createSqliteAdapter();
  t.after(() => client.close());
  const repository = new SqliteDocumentRepository(client);
  await assert.rejects(repository.commitBatch({
    commandId: 'compact-invalid-batch',
    operations: [
      { type: 'put', store: 'tasks', record: { UUID: 'would-be-partial', name: 'First' } },
      { type: 'put', store: 'players', record: { username: 'Missing identity' } },
    ],
  }), /require UUID/i);
  assert.equal(await repository.get('tasks', 'would-be-partial'), null);

  await repository.commitBatch({
    commandId: 'compact-valid-batch',
    operations: [
      { type: 'put', store: 'tasks', record: { UUID: 'task-a', name: 'A' } },
      { type: 'put', store: 'players', record: { UUID: 'player-a', username: 'Player' } },
    ],
  });
  assert.equal((await repository.get('tasks', 'task-a')).name, 'A');
  assert.equal((await repository.get('players', 'player-a')).username, 'Player');
  const integrity = await client.integrityCheck();
  assert.equal(integrity.ok, true);
  assert.deepEqual(integrity.integrityRows, ['ok']);
  assert.deepEqual(integrity.foreignKeyViolations, []);
});
