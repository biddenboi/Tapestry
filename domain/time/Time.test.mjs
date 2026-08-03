import assert from 'node:assert/strict';
import test from 'node:test';
import * as time from './Time.js';

test('current IGT accepts an injected clock and freezes inactive profiles', () => {
  const startedAt = Date.parse('2026-07-14T12:00:00.000Z');
  assert.equal(time.getCurrentIGT({
    inGameTime: 1_000,
    utcTimeAtStart: '2026-07-14T12:00:00.000Z',
  }, startedAt + 5_000), 6_000);
  assert.equal(time.getCurrentIGT({ inGameTime: 7_500 }, startedAt + 50_000), 7_500);
});

test('current IGT cannot run backward and invalid anchors preserve the stored cursor', () => {
  const startedAt = Date.parse('2026-07-14T12:00:00.000Z');
  assert.equal(time.getCurrentIGT({
    inGameTime: '1000',
    utcTimeAtStart: '2026-07-14T12:00:00.000Z',
  }, startedAt - 1_000), 1_000);
  assert.equal(time.getCurrentIGT({ inGameTime: 2_000, utcTimeAtStart: 'invalid' }, 10_000), 2_000);
});

test('world clock uses the exact uppercase DAY N · HH:MM product format', () => {
  assert.equal(time.formatWorldIGT(11 * 86_400_000 + 7 * 3_600_000 + 43 * 60_000), 'DAY 12 · 07:43');
  assert.equal(time.formatWorldIGT(Number.NaN), 'DAY 1 · 00:00');
});
