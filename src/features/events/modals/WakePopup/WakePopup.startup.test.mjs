import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const popup = await readFile(new URL('./WakePopup.jsx', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../../../../domain/events/DailyLifecycleService.js', import.meta.url), 'utf8');
const boundary = await readFile(new URL('../../../../domain/events/DayBoundary.js', import.meta.url), 'utf8');

test('WakePopup imports defined wake storage-key helpers through the lifecycle boundary', () => {
  assert.match(popup, /getWakePendingStorageKey as wakeKey/);
  assert.match(popup, /getWakeCompletedStorageKey as wakeCompletedKey/);
  assert.match(lifecycle, /getWakePendingStorageKey/);
  assert.match(lifecycle, /getWakeCompletedStorageKey/);
  assert.match(boundary, /export function getWakePendingStorageKey/);
  assert.match(boundary, /export function getWakeCompletedStorageKey/);
  assert.doesNotMatch(popup, /const wakeKey\s*=/);
});

test('a reload can resume a previously submitting wake lifecycle', () => {
  assert.doesNotMatch(popup, /if \(wakeState === 'submitting'\) return/);
  assert.match(boundary, /return !completedToday && wakeState !== 'completed'/);
  assert.match(boundary, /globalThis\.localStorage/);
});

test('entering the day uses the wall-clock player projection without session checkpoints', () => {
  assert.match(lifecycle, /const current = await databaseConnection\.getCurrentPlayer\(\)/);
  assert.doesNotMatch(lifecycle, /checkpointCurrentPlayerIGTSession/);
});
