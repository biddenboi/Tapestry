import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const immediate = await readFile(new URL('./completeTodoNow.js', import.meta.url), 'utf8');
const timed = await readFile(new URL('../context/TaskSessionProvider.jsx', import.meta.url), 'utf8');
const service = await readFile(new URL('./TaskCompletionService.js', import.meta.url), 'utf8');
const processors = await readFile(new URL('./TaskCompletionProcessors.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../../app/App.jsx', import.meta.url), 'utf8');
const recommender = await readFile(new URL('../../../domain/tasks/TaskRecommender.js', import.meta.url), 'utf8');
const todoList = await readFile(new URL('../components/TodoList/TodoList.jsx', import.meta.url), 'utf8');
const todoListView = await readFile(new URL('../components/TodoList/TodoListView.jsx', import.meta.url), 'utf8');

test('immediate and timed completion both delegate to the canonical service', () => {
  assert.match(immediate, /completeTask\s*\(/);
  assert.match(timed, /TaskSessionController\(\{ completeTask \}\)/);
  for (const source of [immediate, timed]) {
    assert.doesNotMatch(source, /recordTaskContribution|syncContributionPassRewards|applyDojoContribution|checkPassiveAchievements/);
  }
});

test('the primary service atomically commits recurrence, reward, and the recovery marker', () => {
  assert.match(service, /STORES\.taskCompletionEvent/);
  assert.match(service, /databaseConnection\.commitAtomicMutation/);
  assert.match(service, /operationId/);
  assert.match(service, /taskOccurrenceKey/);
  assert.match(service, /commandType: 'completeTaskOccurrence'/);
  assert.match(service, /puts\.push\(\{ store: STORES\.taskCompletionEvent/);
  assert.match(service, /queueTaskCompletionSecondaryProcessing/);
  assert.doesNotMatch(service, /recordTaskContribution|syncContributionPassRewards|applyDojoContribution|checkPassiveAchievements/);
});

test('secondary processors use durable receipts keyed by completion-event ID without auto-claiming Road rewards', () => {
  for (const processor of ['contributions', 'dojo-leaderboard', 'dojo-contribution', 'achievements', 'recommender-outcome']) {
    assert.match(processors, new RegExp(`['\"]${processor}['\"]`));
  }
  assert.doesNotMatch(processors, /pass-rewards|claimContributionPassReward|syncContributionPassRewards/);
  assert.doesNotMatch(processors, /map-record|getCurrentLocation|improveTaskLocation/);
  assert.match(processors, /processorReceiptUUID\(completionEventUUID, processor\)/);
  assert.match(processors, /recoverPendingTaskCompletionProcessing/);
  assert.match(app, /requested\.includes\('tasks'\).*recoverTaskCompletions/s);
  assert.match(app, /import\('@features\/tasks\/domain\/TaskCompletionProcessors\.js'\)/);
  assert.match(recommender, /entry\?\.completionEventUUID === completionEventUUID/);
});

test('task checkboxes expose the save in progress and reload from the durable record', () => {
  assert.match(todoList, /await databaseConnection\.getCurrentPlayer\(\)/);
  assert.match(todoList, /if \(!completion\) throw new Error/);
  assert.match(todoList, /await reload\(\)/);
  assert.match(todoListView, /aria-busy=\{completingId === task\.UUID\}/);
  assert.match(todoListView, /disabled=\{Boolean\(completingId\)\}/);
});
