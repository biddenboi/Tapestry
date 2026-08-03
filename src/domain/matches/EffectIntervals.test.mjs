import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateWeightedEffectDuration } from './EffectIntervals.js';

test('effect overlap scores exact partial-duration multipliers', () => {
  const result = calculateWeightedEffectDuration({
    activityIntervals: [{ startsAt: '2026-08-02T19:00:00Z', endsAt: '2026-08-02T19:30:00Z' }],
    effectIntervals: [{
      startsAt: '2026-08-02T19:00:00Z',
      endsAt: '2026-08-02T19:15:00Z',
      multiplier: 2,
      stackingRule: 'multiply',
    }],
  });
  assert.equal(result.activeMs, 30 * 60_000);
  assert.equal(result.weightedActiveMs, 45 * 60_000);
  assert.equal(result.averageMultiplier, 1.5);
  assert.deepEqual(result.segments.map(({ durationMs, multiplier }) => [durationMs, multiplier]), [
    [15 * 60_000, 2],
    [15 * 60_000, 1],
  ]);
});

test('paused gaps never receive effect credit', () => {
  const result = calculateWeightedEffectDuration({
    activityIntervals: [
      { startsAt: '2026-08-02T19:00:00Z', endsAt: '2026-08-02T19:10:00Z' },
      { startsAt: '2026-08-02T19:20:00Z', endsAt: '2026-08-02T19:30:00Z' },
    ],
    effectIntervals: [{
      startsAt: '2026-08-02T19:10:00Z',
      endsAt: '2026-08-02T19:20:00Z',
      multiplier: 3,
    }],
  });
  assert.equal(result.activeMs, 20 * 60_000);
  assert.equal(result.weightedActiveMs, 20 * 60_000);
});
