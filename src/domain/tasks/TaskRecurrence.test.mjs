import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceRecurringTodo,
  nextTaskOccurrence,
  parseTaskRecurrence,
} from './TaskRecurrence.js';

test('parses Todoist-style repeat phrases', () => {
  assert.deepEqual(parseTaskRecurrence('Walk every day').recurrence.frequency, 'day');
  assert.equal(parseTaskRecurrence('Review every 5 days').recurrence.interval, 5);
  assert.deepEqual(parseTaskRecurrence('Plan every sunday').recurrence.weekdays, [0]);
  assert.equal(parseTaskRecurrence('Pay rent every month').recurrence.frequency, 'month');
});

test('advances recurring due dates beyond the completed occurrence', () => {
  const next = nextTaskOccurrence(
    { dueDate: '2026-07-01T15:00:00.000Z', recurrence: { frequency: 'day', interval: 5 } },
    '2026-07-12T12:00:00.000Z',
  );
  assert.equal(next.toISOString(), '2026-07-16T15:00:00.000Z');
  assert.equal(advanceRecurringTodo({ dueDate: '2026-07-31T12:00:00.000Z', recurrence: { frequency: 'month', interval: 1 } }, '2026-07-31T13:00:00.000Z').dueDate, '2026-08-31T12:00:00.000Z');
});

test('always advances once from the scheduled date, even when completed early', () => {
  const daily = nextTaskOccurrence(
    { dueDate: '2026-08-02T14:00:00.000Z', recurrence: { frequency: 'day', interval: 1 } },
    '2026-08-01T14:00:00.000Z',
  );
  assert.equal(daily.toISOString(), '2026-08-03T14:00:00.000Z');

  const fiveDays = nextTaskOccurrence(
    { dueDate: '2026-08-01T14:00:00.000Z', recurrence: { frequency: 'day', interval: 5 } },
    '2026-08-01T15:00:00.000Z',
  );
  assert.equal(fiveDays.toISOString(), '2026-08-06T14:00:00.000Z');
});

test('weekday and named-weekday schedules choose a strictly future allowed day', () => {
  const weekday = nextTaskOccurrence(
    { dueDate: '2026-07-31T14:00:00.000Z', recurrence: { frequency: 'day', interval: 1, weekdays: [1, 2, 3, 4, 5] } },
    '2026-07-31T15:00:00.000Z',
  );
  assert.equal(weekday.getDay(), 1);

  const sunday = nextTaskOccurrence(
    { dueDate: '2026-08-02T14:00:00.000Z', recurrence: { frequency: 'week', interval: 1, weekdays: [0] } },
    '2026-08-02T15:00:00.000Z',
  );
  assert.equal(sunday.getDay(), 0);
  assert.equal(sunday.getDate(), 9);

  const saturday = nextTaskOccurrence(
    { dueDate: '2026-08-01T14:00:00.000Z', recurrence: { frequency: 'week', interval: 1, weekdays: [6] } },
    '2026-08-01T15:00:00.000Z',
  );
  assert.equal(saturday.getDay(), 6);
  assert.equal(saturday.getDate(), 8);
});

test('monthly recurrence retains its original end-of-month anchor', () => {
  const february = advanceRecurringTodo(
    { dueDate: '2027-01-31T15:00:00.000Z', recurrence: { frequency: 'month', interval: 1 } },
    '2027-01-31T16:00:00.000Z',
  );
  assert.equal(february.recurrence.anchorDay, 31);
  assert.equal(new Date(february.dueDate).getDate(), 28);

  const march = advanceRecurringTodo(february, new Date(february.dueDate).getTime() + 60_000);
  assert.equal(march.recurrence.anchorDay, 31);
  assert.equal(new Date(march.dueDate).getDate(), 31);
});

test('recurrence preserves local wall-clock time across a DST boundary', () => {
  const due = new Date(2027, 2, 13, 9, 30);
  const next = nextTaskOccurrence(
    { dueDate: due.toISOString(), recurrence: { frequency: 'day', interval: 1 } },
    new Date(2027, 2, 13, 10, 0),
  );
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 30);
});

test('invalid due dates recover from completion time and still advance', () => {
  const completed = new Date(2026, 7, 1, 11, 45);
  const next = nextTaskOccurrence(
    { dueDate: 'not-a-date', recurrence: { frequency: 'day', interval: 1 } },
    completed,
  );
  assert.equal(next.getDate(), completed.getDate() + 1);
  assert.equal(next.getHours(), completed.getHours());
  assert.equal(next.getMinutes(), completed.getMinutes());
});
