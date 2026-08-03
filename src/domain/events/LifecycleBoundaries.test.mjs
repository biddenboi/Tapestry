import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./LifecycleBoundaries.js', import.meta.url), 'utf8');
const boundaries = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('daily lifecycle schedules the earliest known wake, sleep, or midnight boundary', () => {
  const now = new Date(2026, 6, 11, 8, 0, 0, 0);
  const next = boundaries.getNextDailyLifecycleBoundary({ wakeTime: '07:00', sleepTime: '22:30' }, now);
  assert.equal(next.type, 'sleep');
  assert.equal(new Date(next.at).getHours(), 22);
  assert.equal(new Date(next.at).getMinutes(), 30);
});

test('past schedule times roll to the following local day', () => {
  const now = new Date(2026, 6, 11, 23, 30, 0, 0);
  const next = boundaries.getNextDailyLifecycleBoundary({ wakeTime: '07:00', sleepTime: '22:30' }, now);
  assert.equal(next.type, 'day-boundary');
  assert.equal(new Date(next.at).getDate(), 12);
  assert.equal(new Date(next.at).getHours(), 0);
});
