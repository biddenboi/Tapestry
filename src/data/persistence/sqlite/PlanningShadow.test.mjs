import assert from 'node:assert/strict';
import test from 'node:test';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const now = new Date('2026-07-12T18:00:00.000Z');

async function seedPlayer(context) {
  await context.shadow.importers.coreProfiles.import({
    players: [{ UUID: 'p1', username: 'Planner', createdAt: '2026-07-01T00:00:00.000Z' }],
    appState: { activePlayerUUID: 'p1' }, economyState: { globalMoney: 0 }, settings: [],
  });
}

test('Batch 12 imports 311 tasks without embedded prior-task objects and quarantines cycles', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await seedPlayer(context);
  const tasks = Array.from({ length: 311 }, (_, index) => ({
    UUID: `task-${String(index).padStart(3, '0')}`,
    parent: 'p1',
    name: `Task ${index}`,
    efficiency: `Plan notes ${index}`,
    points: index,
    completedAt: new Date(now.getTime() - index * 1000).toISOString(),
    inGameTimestamp: index * 10,
    completedInGameTimestamp: index * 10 + 5,
    ...(index > 0 ? { lastCompletedTask: { UUID: `task-${String(index - 1).padStart(3, '0')}`, name: 'embedded copy must disappear' } } : {}),
  }));
  tasks[5].lastCompletedTask = { UUID: tasks[5].UUID };
  tasks[20].lastCompletedTask = { UUID: tasks[21].UUID };
  tasks[21].lastCompletedTask = { UUID: tasks[20].UUID };

  const imported = await context.shadow.importers.planning.import({ tasks });
  assert.equal(imported.counts.tasks, 311);
  assert.ok(imported.diagnostics.some((entry) => entry.reason === 'self-previous-task-link'));
  assert.ok(imported.diagnostics.some((entry) => entry.reason === 'previous-task-cycle'));
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM tasks', result: 'value' }), 311);

  const row = await context.shadow.planning.getTask('task-010');
  assert.equal(row.efficiency, 'Plan notes 10');
  assert.equal(row.previousTaskId, 'task-009');
  assert.equal('lastCompletedTask' in row, false);
  assert.equal((await context.shadow.planning.getTask('task-005')).previousTaskId, null);
  assert.equal((await context.shadow.planning.getTask('task-020')).previousTaskId, null);
  assert.equal((await context.shadow.planning.getTask('task-021')).previousTaskId, null);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 12 preserves ordering, time boundaries, reminder behavior, and atomic completion', async (t) => {
  let current = new Date(now);
  const context = await createShadowTestContext({ now: () => new Date(current) });
  t.after(context.close);
  await seedPlayer(context);
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'goal', parent: 'p1', name: 'Goal' }],
    todos: [
      { UUID: 'todo-later', parent: 'p1', projectId: 'goal', name: 'Later', dueDate: '2026-07-13T00:00:00.000Z' },
      { UUID: 'todo-soon', parent: 'p1', projectId: 'goal', name: 'Soon', dueDate: '2026-07-12T19:00:00.000Z' },
      { UUID: 'todo-none', parent: 'p1', name: 'No date' },
    ],
    tasks: [
      { UUID: 'old', parent: 'p1', name: 'Old', completedAt: '2026-07-10T00:00:00.000Z', completedInGameTimestamp: 100, points: 2 },
      { UUID: 'new', parent: 'p1', name: 'New', completedAt: '2026-07-11T00:00:00.000Z', completedInGameTimestamp: 200, points: 3 },
    ],
    reminders: [
      { UUID: 'due', parent: 'p1', title: 'Due', remindAt: '2026-07-12T17:59:00.000Z', createdAt: '2026-07-12T17:00:00.000Z' },
      { UUID: 'future', parent: 'p1', title: 'Future', remindAt: '2026-07-12T19:00:00.000Z', createdAt: '2026-07-12T17:00:00.000Z' },
      { UUID: 'snoozed', parent: 'p1', title: 'Snoozed', remindAt: '2026-07-12T17:00:00.000Z', snoozedUntil: '2026-07-12T20:00:00.000Z' },
    ],
  });

  assert.deepEqual((await context.shadow.planning.listTodos('p1')).map((row) => row.UUID), ['todo-soon', 'todo-later', 'todo-none']);
  assert.deepEqual((await context.shadow.planning.listTasks('p1')).map((row) => row.UUID), ['new', 'old']);
  assert.deepEqual((await context.shadow.planning.getTasksThroughIGT('p1', 150)).map((row) => row.UUID), ['old']);
  assert.deepEqual((await context.shadow.planning.getDueReminders('p1', now)).map((row) => row.UUID), ['due']);
  assert.deepEqual((await context.shadow.planning.getUpcomingReminders('p1')).map((row) => row.UUID), ['due', 'future', 'snoozed']);

  const completed = await context.shadow.planning.commitPlanningCompletion({
    task: { UUID: 'completed', parent: 'p1', projectId: 'goal', todoUUID: 'todo-soon', name: 'Soon', completedAt: now.toISOString(), points: 5 },
    sourceTodoId: 'todo-soon', operationId: 'complete-1',
  });
  assert.equal(completed.task.UUID, 'completed');
  assert.equal((await context.shadow.planning.listTodos('p1')).some((row) => row.UUID === 'todo-soon'), false);
  const duplicate = await context.shadow.planning.commitPlanningCompletion({
    task: { UUID: 'completed', parent: 'p1', projectId: 'goal', todoUUID: 'todo-soon', name: 'Soon', completedAt: now.toISOString(), points: 5 },
    sourceTodoId: 'todo-soon', operationId: 'complete-1',
  });
  assert.equal(duplicate.duplicate, true);

  current = new Date('2026-07-12T18:05:00.000Z');
  const snoozed = await context.shadow.planning.snoozeReminder('due', 10, { operationId: 'snooze-1' });
  assert.equal(snoozed.reminder.snoozedUntil, '2026-07-12T18:15:00.000Z');
  const plan = await context.shadow.planning.explainTaskTimeline('p1');
  assert.ok(plan.some((row) => /tasks_player_igt_idx/i.test(String(row.detail || ''))));
});
