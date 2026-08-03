import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./HabitPageModels.js', import.meta.url), 'utf8');
const models = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const todayKey = '2026-07-27';
const nowMs = new Date('2026-07-27T12:00:00').getTime();

test('one-time cards use only the current tracking era and render 12 weeks', () => {
  const card = models.buildHabitCardModel({
    event: { UUID: 'one', type: 'one_time', name: 'Read', currentEraId: 'era-2' },
    logs: [
      { trackingEraId: 'era-1', action: 'complete', status: 'success', loggedDate: todayKey },
      { trackingEraId: 'era-2', action: 'complete', status: 'success', loggedDate: '2026-07-26' },
    ],
    todayKey,
    nowMs,
  });

  assert.equal(card.complete, false);
  assert.equal(card.streak, 1);
  assert.equal(card.series.length, 84);
  assert.equal(card.series.at(-1).value, 0);
});

test('quantity cards aggregate canonical add entries and complete at target', () => {
  const card = models.buildHabitCardModel({
    event: { UUID: 'quantity', type: 'quantity', name: 'Pages', unit: 'pages', dailyTarget: 10, currentEraId: 'era-q' },
    logs: [
      { trackingEraId: 'era-q', action: 'add', status: 'success', value: 4, loggedDate: todayKey },
      { trackingEraId: 'era-q', action: 'add', status: 'success', value: 6, loggedDate: todayKey },
      { trackingEraId: 'era-q', action: 'complete', status: 'success', value: 100, loggedDate: todayKey },
    ],
    todayKey,
    nowMs,
  });

  assert.equal(card.todayTotal, 10);
  assert.equal(card.complete, true);
  assert.equal(card.series.length, 14);
});

test('an unmatched duration start keeps accruing wall-clock time while the app is closed', () => {
  const card = models.buildHabitCardModel({
    event: { UUID: 'duration', type: 'duration', name: 'Practice', dailyTarget: 30 * 60 * 1000, currentEraId: 'era-d' },
    logs: [{
      trackingEraId: 'era-d',
      action: 'start',
      status: 'started',
      sessionUUID: 'session-1',
      loggedAt: '2026-07-27T11:15:00',
      loggedDate: todayKey,
    }],
    todayKey,
    nowMs,
  });

  assert.equal(card.isRunning, true);
  assert.equal(card.todayTotal, 45 * 60 * 1000);
  assert.equal(card.complete, false, 'running timers do not move to completed even after reaching target');
});

test('stopped duration segments credit each calendar day and allow completion', () => {
  const logs = [
    { trackingEraId: 'era-d', action: 'start', status: 'started', sessionUUID: 'session-1', loggedAt: '2026-07-26T23:45:00' },
    {
      trackingEraId: 'era-d', action: 'stop', status: 'success', sessionUUID: 'session-1', loggedAt: '2026-07-27T00:30:00', value: 45 * 60 * 1000,
      segments: [
        { loggedDate: '2026-07-26', durationMs: 15 * 60 * 1000 },
        { loggedDate: todayKey, durationMs: 30 * 60 * 1000 },
      ],
    },
  ];
  const card = models.buildHabitCardModel({
    event: { UUID: 'duration', type: 'duration', name: 'Practice', dailyTarget: 30 * 60 * 1000, currentEraId: 'era-d' },
    logs,
    todayKey,
    nowMs,
  });

  assert.equal(card.isRunning, false);
  assert.equal(card.todayTotal, 30 * 60 * 1000);
  assert.equal(card.complete, true);
  assert.equal(models.totalForTrackerDate('duration', logs, '2026-07-26'), 15 * 60 * 1000);
});

test('page model keeps completed habits below unfinished habits', () => {
  const model = models.buildHabitPageModel({
    events: [
      { UUID: 'a', type: 'one_time', name: 'Active', currentEraId: 'era-a' },
      { UUID: 'b', type: 'one_time', name: 'Done', currentEraId: 'era-b' },
    ],
    logsByEvent: {
      b: [{ trackingEraId: 'era-b', action: 'complete', status: 'success', loggedDate: todayKey }],
    },
    todayKey,
    nowMs,
  });

  assert.deepEqual(model.active.map((card) => card.id), ['a']);
  assert.deepEqual(model.completed.map((card) => card.id), ['b']);
});
