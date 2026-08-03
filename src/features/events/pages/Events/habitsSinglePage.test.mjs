import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const [events, page, css, repository, eventDomain] = await Promise.all([
  read('./Events.jsx'),
  read('./HabitPage.jsx'),
  read('./styles/Habits.page.css'),
  read('../../../../domain/events/EventDomainRepository.js'),
  read('../../../../domain/events/Events.js'),
]);

test('single-page habit controls and charts are wired', () => {
  assert.match(page, /type="range"/);
  assert.match(page, /function OneTimeGraph/);
  assert.match(page, /function QuantityGraph/);
  assert.match(page, /function DurationGraph/);
  assert.match(page, /Completed today/);
  assert.match(page, /Previous tracking periods/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /habit-complete-burst/);
});

test('duration actions are append-only and each action records its own IGT', () => {
  assert.match(eventDomain, /action: 'start'/);
  assert.match(eventDomain, /action: 'stop'/);
  assert.match(eventDomain, /sessionUUID/);
  assert.match(eventDomain, /inGameTimestamp: getCurrentIGT\(player\)/);
  assert.match(eventDomain, /splitDurationSessionByDay/);
  assert.doesNotMatch(eventDomain, /checkHabitFailures/);
  assert.match(events, /startDurationHabit/);
  assert.match(events, /stopDurationHabit/);
});

test('tracker repository filters logs to canonical definitions', () => {
  assert.match(repository, /TRACKER_TYPES = new Set\(\['one_time', 'quantity', 'duration'\]\)/);
  assert.match(repository, /trackerIds\.has\(String\(log\.eventUUID\)\)/);
});
