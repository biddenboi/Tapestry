import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteTaskCommand, saveTaskCommand } from './TaskCommands.js';

function database() {
  const rows = new Map();
  const commits = [];
  return {
    rows,
    commits,
    async get(_store, id) { return rows.get(id) || null; },
    createSyncCommandContext(input) { return { ...input, enqueueSync: true }; },
    async commitAtomicMutation(command) {
      commits.push(command);
      for (const put of command.puts || []) rows.set(put.record.UUID, put.record);
      for (const deletion of command.deletes || []) rows.delete(deletion.UUID);
      return { changed: true };
    },
  };
}

test('task create, update, and delete carry monotonic conflict versions', async () => {
  const connection = database();
  const created = await saveTaskCommand(connection, { UUID: 't1', parent: 'p1', name: 'First' }, { operationId: 'create-1' });
  assert.equal(created.task.syncVersion, 1);
  assert.equal(connection.commits[0].sync.commandType, 'createTask');
  assert.equal(connection.commits[0].sync.baseVersion, 0);

  const updated = await saveTaskCommand(connection, { ...created.task, name: 'Second' }, { operationId: 'update-1' });
  assert.equal(updated.task.syncVersion, 2);
  assert.equal(connection.commits[1].sync.commandType, 'updateTask');
  assert.equal(connection.commits[1].sync.baseVersion, 1);

  await deleteTaskCommand(connection, updated.task, { operationId: 'delete-1' });
  assert.equal(connection.commits[2].sync.commandType, 'deleteTask');
  assert.equal(connection.commits[2].sync.baseVersion, 2);
  assert.equal(connection.rows.has('t1'), false);
});
