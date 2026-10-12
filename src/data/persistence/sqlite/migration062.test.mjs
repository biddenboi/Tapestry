import test from 'node:test';
import assert from 'node:assert/strict';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import MigrationRunner from './MigrationRunner.js';
import migrations from './migrations/index.js';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';

test('retiring Events imports habits once and preserves work, journals and old day history', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  await new MigrationRunner({ client, migrations: migrations.filter((m) => m.id < '062') }).run();
  await client.executeAtomic({ commandId: 'seed-event-owner', statements: [
    { sql: "INSERT INTO players(id,username) VALUES('p','Peter')" },
  ] });
  const docs = new SqliteDocumentRepository(client);
  await docs.put('players', { UUID: 'p', wakeChecklist: ['Water'], sleepChecklist: [], tokens: 42 });
  await docs.put('customEvents', { UUID: 'old-habit', parent: 'p', type: 'duration', name: 'Read', dailyTarget: 15 });
  await docs.put('journals', { UUID: 'memory', parent: 'p', title: 'A memory', entry: 'Keep this' });
  await docs.put('events', { UUID: 'old-day', parent: 'p', type: 'wake' });
  await new MigrationRunner({ client, migrations }).run();
  await new MigrationRunner({ client, migrations }).run();
  const todos = await docs.getAll('todos');
  assert.equal(todos.length, 2);
  const habit = todos.find((row) => row.name === 'Read');
  assert.equal(habit.isHabit, true);
  assert.equal(habit.habitMinMinutes, 15);
  assert.equal(habit.recurrence.frequency, 'day');
  assert.equal((await client.query({ sql: "SELECT is_habit FROM todos WHERE id='event-habit:old-habit'", result: 'value' })), 1);
  assert.deepEqual(await docs.getAll('customEvents'), []);
  assert.equal((await docs.get('players', 'p')).tokens, 42);
  assert.equal((await docs.get('journals', 'memory')).entry, 'Keep this');
  assert.ok(await docs.get('events', 'old-day'));
  assert.equal((await client.integrityCheck()).ok, true);
});
