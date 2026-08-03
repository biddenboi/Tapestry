import assert from 'node:assert/strict';
import test from 'node:test';
import {
  measureRuntimeWork,
  recordRuntimeWork,
  resetRuntimePerformance,
  summarizeRuntimePerformance,
} from './RuntimePerformance.js';

test('runtime performance keeps bounded work visibility and identifies long work', async () => {
  resetRuntimePerformance();
  recordRuntimeWork('small', 4, { category: 'ui' });
  await measureRuntimeWork('background-test', async () => 'ok', { background: true, category: 'job' });
  recordRuntimeWork('long', 75, { background: true });
  const summary = summarizeRuntimePerformance();
  assert.equal(summary.measuredWorkCount, 3);
  assert.equal(summary.backgroundWorkCount, 2);
  assert.equal(summary.longMeasuredWorkCount, 1);
  assert.equal(summary.longestWorkMs, 75);
});
