import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [terminologySource, events, habitPage, eventView, eventDetail, gameHub, taskCreation] = await Promise.all([
  read('./terminology.js'),
  read('./pages/Events/Events.jsx'),
  read('./pages/Events/HabitPage.jsx'),
  read('./pages/Events/EventsView.jsx'),
  read('./modals/EventDetailModal/EventDetailModal.jsx'),
  read('../../app/shell/GameHub/GameHub.jsx'),
  read('../tasks/modals/TaskCreationMenu/TaskCreationMenu.jsx'),
]);
const terminology = await import(`data:text/javascript;base64,${Buffer.from(terminologySource).toString('base64')}`);
const terms = terminology.EVENT_TERMINOLOGY;

test('Events navigation and canonical tracker labels are direct', () => {
  assert.equal(terms.navigation.label, 'Events');
  assert.equal(terms.headings.habits, 'Events');
  assert.equal(terms.types.oneTime, 'One time');
  assert.equal(terms.types.quantity, 'Quantity');
  assert.equal(terms.types.duration, 'Duration');
  assert.match(terms.navigation.title, /Events, goals, and daily schedule/);
});

test('Events is a single page and Goals opens from its header', () => {
  assert.match(habitPage, /<h1>Events<\/h1>/);
  assert.match(habitPage, /onClick=\{onOpenGoals\}>Goals/);
  assert.match(events, /setMode\(\{ view: 'goals' \}\)/);
  assert.match(eventView, />Active Goals</);
  assert.match(eventView, /Paused \/ completed/);
  assert.match(taskCreation, /Goals button in the Events header/);
  assert.doesNotMatch(`${events}\n${habitPage}`, /Habits & Quantities|Habit Circuit|station/i);
});

test('event detail recognizes all canonical tracker types', () => {
  assert.match(eventDetail, /EVENT_TERMINOLOGY\.types\.oneTime/);
  assert.match(eventDetail, /EVENT_TERMINOLOGY\.types\.quantity/);
  assert.match(eventDetail, /EVENT_TERMINOLOGY\.types\.duration/);
  assert.match(gameHub, /EVENT_TERMINOLOGY\.navigation\.label/);
});

test('obsolete tracker modules are removed', async () => {
  for (const relative of [
    './pages/Events/EventHabitModels.js',
    './pages/Events/EventsHabitShell.jsx',
    './pages/Events/GoalArenaBoard.jsx',
    './pages/Events/styles/Events.cards.css',
    './pages/Events/styles/Events.detail.css',
  ]) {
    await assert.rejects(access(new URL(relative, import.meta.url)));
  }
});
