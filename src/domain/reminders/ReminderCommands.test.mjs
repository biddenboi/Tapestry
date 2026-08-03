import assert from 'node:assert/strict';
import test from 'node:test';

import { saveReminderCommand, transitionReminderCommand } from './ReminderCommands.js';

test('reminder lifecycle operations use the same versioned command envelope', async () => {
  const rows = new Map();
  const commits = [];
  const connection = {
    async get(_store, id) { return rows.get(id) || null; },
    createSyncCommandContext(input) { return { ...input, enqueueSync: true }; },
    async commitAtomicMutation(command) {
      commits.push(command);
      for (const put of command.puts || []) rows.set(put.record.UUID, put.record);
      return { changed: true };
    },
  };
  const created = await saveReminderCommand(connection, {
    UUID: 'r1', parent: 'p1', title: 'Look up', remindAt: '2026-08-03T10:00:00Z',
  }, { operationId: 'reminder-create-1' });
  const snoozed = await transitionReminderCommand(
    connection,
    created.reminder,
    'snoozeReminder',
    { snoozedUntil: '2026-08-03T10:10:00Z' },
    { operationId: 'reminder-snooze-1' },
  );
  assert.equal(commits[0].sync.commandType, 'createReminder');
  assert.equal(commits[0].sync.baseVersion, 0);
  assert.equal(commits[1].sync.commandType, 'snoozeReminder');
  assert.equal(commits[1].sync.baseVersion, 1);
  assert.equal(snoozed.reminder.syncVersion, 2);
});
