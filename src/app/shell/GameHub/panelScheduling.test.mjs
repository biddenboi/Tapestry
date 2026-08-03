import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./panelScheduling.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  MAX_SCHEDULE_DELAY_MS,
  getNextLocalDayBoundary,
  getNextReminderDeadline,
  getScheduledDelay,
} = await import(moduleUrl);

test('reminder scheduling selects the earliest future active reminder', () => {
  const now = Date.parse('2026-07-10T12:00:00.000Z');
  const reminders = [
    { UUID: 'due', remindAt: '2026-07-10T11:59:00.000Z' },
    { UUID: 'later', remindAt: '2026-07-10T14:00:00.000Z' },
    { UUID: 'next', remindAt: '2026-07-10T12:30:00.000Z' },
    { UUID: 'dismissed', remindAt: '2026-07-10T12:05:00.000Z', dismissedAt: '2026-07-10T11:00:00.000Z' },
  ];
  assert.equal(getNextReminderDeadline(reminders, now), Date.parse('2026-07-10T12:30:00.000Z'));
});

test('snooze time takes precedence over original reminder time', () => {
  const now = Date.parse('2026-07-10T12:00:00.000Z');
  assert.equal(getNextReminderDeadline([{
    remindAt: '2026-07-10T12:05:00.000Z',
    snoozedUntil: '2026-07-10T12:45:00.000Z',
  }], now), Date.parse('2026-07-10T12:45:00.000Z'));
});

test('day-boundary scheduling targets the next local midnight once', () => {
  const start = new Date(2026, 6, 10, 18, 42, 11, 500);
  const boundary = new Date(getNextLocalDayBoundary(start));
  assert.equal(boundary.getFullYear(), 2026);
  assert.equal(boundary.getMonth(), 6);
  assert.equal(boundary.getDate(), 11);
  assert.equal(boundary.getHours(), 0);
  assert.equal(boundary.getMinutes(), 0);
  assert.equal(boundary.getSeconds(), 0);
});

test('long deadlines are chunked below the browser timeout ceiling', () => {
  const now = 1_000;
  assert.equal(getScheduledDelay(now + MAX_SCHEDULE_DELAY_MS + 10_000, now), MAX_SCHEDULE_DELAY_MS);
  assert.equal(getScheduledDelay(now - 1, now), 0);
});
