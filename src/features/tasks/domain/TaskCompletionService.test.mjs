import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MINUTE_MS = 60_000;

let source = await readFile(new URL('./TaskCompletionService.js', import.meta.url), 'utf8');
source = source
  .replace("import { v4 as uuid } from 'uuid';", "let nextUUID = 0; const uuid = () => `uuid-${++nextUUID}`;")
  .replace("import { GAME_STATE, MINUTE, STORES } from '@domain/constants.js';", `const GAME_STATE = { idle: 'idle', match: 'match', dojo: 'dojo' };
const MINUTE = 60000;
const STORES = { player: 'players', task: 'tasks', todo: 'todos', project: 'projects', taskCompletionEvent: 'taskCompletionEvents', actionSession: 'actionSessions' };`)
  .replace("import { buildActionReward } from '@domain/rewards/RewardSchedule.js';", "const buildActionReward = () => ({ coins: 3, contribution: 2, bandId: 'band', rarity: 'common', label: 'reward' });")
  .replace("import { getTimeBasedTaskPoints } from '@domain/tasks/Tasks.js';", "const getTimeBasedTaskPoints = (ms) => ({ points: Math.floor(ms / 10000), basePoints: Math.floor(ms / 10000), randomFactor: 1 });")
  .replace("import { getCurrentIGT } from '@domain/time/Time.js';", "const getCurrentIGT = () => 42;")
  .replace("import { advanceRecurringTodo } from '@domain/tasks/TaskRecurrence.js';", "const advanceRecurringTodo = (todo) => todo.recurrence ? { ...todo, dueDate: '2026-07-14T09:00:00.000Z' } : null;")
  .replace("import { DEFAULT_WORKSPACE_ID } from '@domain/planning/WorkspacePlanningScope.js';", "const DEFAULT_WORKSPACE_ID = 'workspace:default';")
  .replace("import { queueTaskCompletionSecondaryProcessing } from './TaskCompletionProcessors.js';", "const queueTaskCompletionSecondaryProcessing = (...args) => { globalThis.__queuedCompletion = args; };");

const { completeTask } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function createDatabase() {
  const stores = new Map();
  const writes = [];
  const bucket = (store) => {
    if (!stores.has(store)) stores.set(store, new Map());
    return stores.get(store);
  };
  return {
    writes,
    stores,
    syncCommands: [],
    async getCurrentPlayer() { return bucket('players').get('player-1') || null; },
    async getActiveEventBuffsForPlayer() { return []; },
    async get(store, id) { return bucket(store).get(id) || null; },
    async add(store, record) { writes.push(['put', store, record.UUID]); bucket(store).set(record.UUID, structuredClone(record)); },
    async remove(store, id) { writes.push(['remove', store, id]); bucket(store).delete(id); },
    createSyncCommandContext(input) {
      this.syncCommands.push(structuredClone(input));
      return { ...input, enqueueSync: true };
    },
    async commitAtomicMutation(input) {
      for (const { store, record } of input.puts || []) {
        writes.push(['put', store, record.UUID]);
        bucket(store).set(record.UUID, structuredClone(record));
      }
      for (const { store, UUID } of input.deletes || []) {
        writes.push(['remove', store, UUID]);
        bucket(store).delete(UUID);
      }
      return { changed: true, duplicate: false };
    },
  };
}

test('immediate completion atomically commits primary records before queuing secondary work', async () => {
  globalThis.__queuedCompletion = null;
  const databaseConnection = createDatabase();
  const player = { UUID: 'player-1', tokens: 10, minutesClearedToday: 5 };
  databaseConnection.stores.set('players', new Map([[player.UUID, player]]));
  databaseConnection.stores.set('todos', new Map([['todo-1', { UUID: 'todo-1' }]]));
  const rewardEvents = [];

  const result = await completeTask({
    databaseConnection,
    task: { UUID: 'todo-1', name: 'Task', estimatedDuration: 10 },
    player,
    completionMode: 'immediate',
    source: 'test',
    origin: 'mobile',
    removeTodo: true,
    emitRewardEvent: (rewards, metadata) => rewardEvents.push({ rewards, metadata }),
  });

  assert.equal(result.completedTask.completionEventUUID, result.completionEvent.UUID);
  assert.equal(result.operationId, 'uuid-1');
  assert.equal(result.occurrenceKey, 'repetition:todo-1:unscheduled');
  assert.equal(result.completedTask.points, 0);
  assert.equal(result.completedTask.pointsBase, 0);
  assert.equal(result.completedTask.pointsRandomFactor, 1);
  assert.equal(result.completedTask.workspaceId, 'workspace:default');
  assert.equal(result.completedTask.parent, 'player-1');
  assert.equal(result.completionEvent.taskUUID, result.completedTask.UUID);
  assert.equal(result.completionEvent.type, 'task-completed');
  assert.equal(databaseConnection.stores.get('taskCompletionEvents').size, 1);
  assert.equal(databaseConnection.stores.get('tasks').size, 1);
  assert.equal(databaseConnection.stores.get('todos').size, 0);
  assert.equal(databaseConnection.stores.get('players').get('player-1').tokens, 13);
  assert.equal(databaseConnection.stores.get('players').get('player-1').minutesClearedToday, 5);
  assert.deepEqual(databaseConnection.writes.map((entry) => entry[1]), [
    'players',
    'tasks',
    'taskCompletionEvents',
    'todos',
  ]);
  assert.equal(rewardEvents.length, 1);
  assert.equal(globalThis.__queuedCompletion[1].UUID, result.completionEvent.UUID);
  assert.equal(databaseConnection.syncCommands.length, 1);
  const [syncCommand] = databaseConnection.syncCommands;
  assert.equal(syncCommand.origin, 'mobile');
  assert.equal(syncCommand.commandType, 'completeTaskOccurrence');
  assert.equal(syncCommand.entityType, 'task-occurrence');
  assert.equal(syncCommand.entityId, result.occurrenceKey);
  assert.equal(syncCommand.payload.updatedPlayer.UUID, 'player-1');
  assert.equal(syncCommand.payload.completedTask.UUID, result.completedTask.UUID);
  assert.equal(syncCommand.payload.completionEvent.UUID, result.completionEvent.UUID);
  assert.equal(syncCommand.payload.removeTodo, true);
});

test('timed work logs actual duration, evaluates commitment, and leaves the Todo open', async () => {
  const databaseConnection = createDatabase();
  const player = { UUID: 'player-1', tokens: 10, minutesClearedToday: 5 };
  const todo = {
    UUID: 'todo-1',
    name: 'Keep working',
    estimatedDuration: 30,
    taskRecommendationEventId: 'recommendation-1',
    recommendation: { suggestedMinutes: 20 },
  };
  databaseConnection.stores.set('players', new Map([[player.UUID, player]]));
  databaseConnection.stores.set('todos', new Map([[todo.UUID, todo]]));

  const result = await completeTask({
    databaseConnection,
    task: todo,
    player,
    completionMode: 'timed',
    startedAt: '2026-07-13T12:00:00.000Z',
    completedAt: '2026-07-13T12:05:00.000Z',
    actualDurationMs: 5 * MINUTE_MS,
    committedMs: 20 * MINUTE_MS,
    removeTodo: false,
    processSecondary: false,
  });

  assert.equal(databaseConnection.stores.get('todos').has(todo.UUID), true);
  assert.equal(databaseConnection.stores.get('players').get(player.UUID).minutesClearedToday, 10);
  assert.equal(result.completionEvent.durationMs, 5 * MINUTE_MS);
  assert.equal(result.completedTask.points, 30);
  assert.equal(result.completedTask.pointsBase, 30);
  assert.equal(result.completionEvent.committedMs, 20 * MINUTE_MS);
  assert.equal(result.completionEvent.recommendation.completed, false);
  assert.equal(result.completedTask.todoUUID, todo.UUID);
});

test('completing a recurring Todo advances it instead of deleting it', async () => {
  const databaseConnection = createDatabase();
  const player = { UUID: 'player-1', tokens: 0, minutesClearedToday: 0 };
  const todo = {
    UUID: 'todo-repeat',
    name: 'Daily review',
    estimatedDuration: 10,
    dueDate: '2026-07-13T09:00:00.000Z',
    recurrence: { unit: 'day', interval: 1, label: 'Every day' },
  };
  databaseConnection.stores.set('players', new Map([[player.UUID, player]]));
  databaseConnection.stores.set('todos', new Map([[todo.UUID, todo]]));

  await completeTask({
    databaseConnection,
    task: todo,
    player,
    completionMode: 'immediate',
    completedAt: '2026-07-13T10:00:00.000Z',
    removeTodo: true,
    processSecondary: false,
  });

  assert.equal(databaseConnection.stores.get('todos').has(todo.UUID), true);
  assert.equal(databaseConnection.stores.get('todos').get(todo.UUID).dueDate, '2026-07-14T09:00:00.000Z');
  assert.equal(databaseConnection.writes.some(([kind, store]) => kind === 'remove' && store === 'todos'), false);
});

test('retrying a completion operation ID does not apply rewards or recurrence twice', async () => {
  const databaseConnection = createDatabase();
  const player = { UUID: 'player-1', tokens: 0, minutesClearedToday: 0 };
  const todo = { UUID: 'todo-1', name: 'Retry-safe', dueDate: '2026-08-02T09:00:00.000Z' };
  databaseConnection.stores.set('players', new Map([[player.UUID, player]]));
  databaseConnection.stores.set('todos', new Map([[todo.UUID, todo]]));
  const originalCommit = databaseConnection.commitAtomicMutation.bind(databaseConnection);
  const receipts = new Set();
  databaseConnection.commitAtomicMutation = async (input) => {
    if (receipts.has(input.operationId)) return { changed: false, duplicate: true };
    receipts.add(input.operationId);
    return originalCommit(input);
  };

  const first = await completeTask({
    databaseConnection,
    task: todo,
    player,
    operationId: 'complete-operation-1',
    completionMode: 'immediate',
    completedAt: '2026-08-02T10:00:00.000Z',
    removeTodo: true,
    processSecondary: false,
  });
  const second = await completeTask({
    databaseConnection,
    task: todo,
    player,
    operationId: 'complete-operation-1',
    completionMode: 'immediate',
    completedAt: '2026-08-02T10:00:00.000Z',
    removeTodo: true,
    processSecondary: false,
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(databaseConnection.stores.get('tasks').size, 1);
  assert.equal(databaseConnection.stores.get('taskCompletionEvents').size, 1);
  assert.equal(databaseConnection.stores.get('players').get(player.UUID).tokens, 3);
});

test('Action Session completion uses the pinned profile and durable Match context', async () => {
  const databaseConnection = createDatabase();
  const selectedPlayer = { UUID: 'player-selected', tokens: 50, minutesClearedToday: 0 };
  const pinnedPlayer = { UUID: 'player-pinned', tokens: 4, minutesClearedToday: 2 };
  const todo = { UUID: 'todo-session', name: 'Pinned work' };
  databaseConnection.stores.set('players', new Map([
    [selectedPlayer.UUID, selectedPlayer],
    [pinnedPlayer.UUID, pinnedPlayer],
  ]));
  databaseConnection.stores.set('todos', new Map([[todo.UUID, todo]]));
  databaseConnection.stores.set('actionSessions', new Map([[
    'session-1',
    {
      UUID: 'session-1',
      parent: pinnedPlayer.UUID,
      targetUUID: todo.UUID,
      matchUUID: 'match-1',
      dojoSessionUUID: null,
    },
  ]]));

  const result = await completeTask({
    databaseConnection,
    task: todo,
    player: selectedPlayer,
    actionSessionUUID: 'session-1',
    gameState: 'idle',
    source: 'manual',
    completionMode: 'timed',
    actualDurationMs: MINUTE_MS,
    removeTodo: true,
    processSecondary: false,
  });

  assert.equal(result.completedTask.parent, pinnedPlayer.UUID);
  assert.equal(result.completedTask.source, 'match');
  assert.equal(result.completionEvent.parent, pinnedPlayer.UUID);
  assert.equal(result.completionEvent.gameState, 'match');
  assert.equal(databaseConnection.stores.get('players').get(selectedPlayer.UUID).tokens, 50);
  assert.equal(databaseConnection.stores.get('players').get(pinnedPlayer.UUID).tokens, 7);
});

test('Action Session completion rejects a different task target', async () => {
  const databaseConnection = createDatabase();
  const player = { UUID: 'player-1', tokens: 0, minutesClearedToday: 0 };
  databaseConnection.stores.set('players', new Map([[player.UUID, player]]));
  databaseConnection.stores.set('actionSessions', new Map([[
    'session-1',
    { UUID: 'session-1', parent: player.UUID, targetUUID: 'todo-expected' },
  ]]));

  await assert.rejects(
    completeTask({
      databaseConnection,
      task: { UUID: 'todo-other', name: 'Wrong task' },
      player,
      actionSessionUUID: 'session-1',
      processSecondary: false,
    }),
    (error) => error.code === 'action-session-target-mismatch',
  );
});
