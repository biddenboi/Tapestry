import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

globalThis.__taskProcessorCounters = {
  contribution: 0,
  dojo: 0,
  achievements: 0,
  recommender: 0,
  leaderboard: 0,
};

let source = await readFile(new URL('./TaskCompletionProcessors.js', import.meta.url), 'utf8');
source = source
  .replace("import { STORES, GAME_STATE } from '@domain/constants.js';", `const STORES = {
  taskCompletionReceipt: 'taskCompletionReceipts', taskCompletionEvent: 'taskCompletionEvents',
  task: 'tasks', player: 'players'
}; const GAME_STATE = { dojo: 'dojo' };`)
  .replace("import { getAchievementByKey } from '@domain/achievements/Achievements.js';", "const getAchievementByKey = (key) => ({ key, label: key });")
  .replace(`import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  processAchievementEvent,
  recordAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';`, `const ACHIEVEMENT_EVENT_TYPE = { taskCompleted: 'task-completed' };
const createAchievementEvent = (event) => ({ UUID: 'achievement:' + event.sourceUUID, ...event });
const recordAchievementEvent = async () => {};
const processAchievementEvent = async () => { globalThis.__taskProcessorCounters.achievements += 1; return { earned: ['earned'] }; };`)
  .replace("import { recordActionContribution, recordTaskContribution } from '@domain/contribution/Contribution.js';", `const recordTaskContribution = async (_db, _player, _task, _reward, options) => { globalThis.__taskProcessorCounters.contribution += 1; return { UUID: options.completionEventUUID, value: 2 }; };
const recordActionContribution = async (_db, _player, options) => { if (options.source === 'dojo') globalThis.__taskProcessorCounters.dojo += 1; return { UUID: options.sourceUUID, value: options.value || 1 }; };`)
  .replace("import { recordTaskRecommendationSessionResult } from '@domain/tasks/TaskRecommender.js';", "const recordTaskRecommendationSessionResult = async (_db, _id, options) => { globalThis.__taskProcessorCounters.recommender += 1; globalThis.__lastRecommenderTiming = structuredClone(options); return { updated: true }; };")
  .replace("import { recordRewardProvenance } from '@domain/rewards/RewardProvenance.js';", "const recordRewardProvenance = async () => ({ UUID: 'provenance' });")
  .replace("import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';", "const getCanonicalTaskPoints = (task) => Math.max(0, Math.floor(Number(task.pointsBase ?? task.points) || 0));")
  ;

const { processTaskCompletionEvent, recoverPendingTaskCompletionProcessing } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function createDatabase(event) {
  const stores = new Map([
    ['taskCompletionEvents', new Map([[event.UUID, event]])],
    ['tasks', new Map([[event.taskUUID, { UUID: event.taskUUID, parent: event.parent, completionEventUUID: event.UUID }]])],
    ['players', new Map([[event.parent, { UUID: event.parent }]])],
  ]);
  const bucket = (store) => {
    if (!stores.has(store)) stores.set(store, new Map());
    return stores.get(store);
  };
  return {
    stores,
    async get(store, id) { return bucket(store).get(id) || null; },
    async getAll(store) { return [...bucket(store).values()]; },
    async add(store, record) { bucket(store).set(record.UUID, structuredClone(record)); },
    async recordDojoStandingCompletion() { globalThis.__taskProcessorCounters.leaderboard += 1; return { updated: true }; },
  };
}

test('every secondary processor runs at most once for a completion-event ID', async () => {
  for (const key of Object.keys(globalThis.__taskProcessorCounters)) globalThis.__taskProcessorCounters[key] = 0;
  const event = {
    UUID: 'completion-1',
    parent: 'player-1',
    taskUUID: 'task-1',
    gameState: 'dojo',
    durationMs: 60000,
    completedAt: '2026-07-11T12:01:00.000Z',
    committedMs: 60000,
    reward: { coins: 1, contribution: 2 },
    recommendation: { eventUUID: 'recommendation-1', suggestedMinutes: 1, acceptedMinutes: 1, completed: true },
  };
  const databaseConnection = createDatabase(event);
  const emitted = [];

  await processTaskCompletionEvent(databaseConnection, event, { emitRewardEvent: (...args) => emitted.push(args) });
  await processTaskCompletionEvent(databaseConnection, event, { emitRewardEvent: (...args) => emitted.push(args) });

  assert.deepEqual(globalThis.__taskProcessorCounters, {
    contribution: 1,
    dojo: 1,
    achievements: 1,
    recommender: 1,
    leaderboard: 1,
  });
  const receipts = [...databaseConnection.stores.get('taskCompletionReceipts').values()];
  assert.equal(receipts.length, 5);
  assert.ok(receipts.every((receipt) => receipt.completionEventUUID === event.UUID));
  assert.ok(receipts.every((receipt) => receipt.status === 'completed'));
  assert.equal(emitted.length, 2, 'replay must not re-emit contribution or achievement rewards');
  assert.equal(globalThis.__lastRecommenderTiming.sessionStartedAt, '2026-07-11T12:00:00.000Z');
  assert.equal(globalThis.__lastRecommenderTiming.sessionFinishedAt, '2026-07-11T12:01:00.000Z');
  assert.equal(globalThis.__lastRecommenderTiming.completedAt, '2026-07-11T12:01:00.000Z');
});

test('startup recovery records orphaned completions once instead of retrying forever', async () => {
  const event = {
    UUID: 'completion-orphan',
    parent: 'deleted-player',
    taskUUID: 'deleted-task',
    completedAt: '2026-07-11T12:01:00.000Z',
  };
  const databaseConnection = createDatabase(event);
  databaseConnection.stores.get('tasks').clear();
  databaseConnection.stores.get('players').clear();

  const first = await recoverPendingTaskCompletionProcessing(databaseConnection);
  const second = await recoverPendingTaskCompletionProcessing(databaseConnection);

  assert.equal(first[0][0].result.outcome, 'orphaned');
  assert.equal(second[0][0].status, 'already-completed');
  const recoveryReceipts = [...databaseConnection.stores.get('taskCompletionReceipts').values()]
    .filter((receipt) => receipt.processor === 'recovery-v1');
  assert.equal(recoveryReceipts.length, 1);
  assert.equal(recoveryReceipts[0].attempts, 1);
});
