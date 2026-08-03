import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActionReward } from './RewardSchedule.js';

test('buildActionReward is deterministic for the same action seed', () => {
  const first = buildActionReward({ actionType: 'task', seed: 'task-1', baseCoins: 12 });
  const second = buildActionReward({ actionType: 'task', seed: 'task-1', baseCoins: 12 });
  assert.deepEqual(first, second);
});

test('manual negative rewards use the same contribution scale but signed negative', () => {
  const positive = buildActionReward({ actionType: 'manual-contribution', seed: 'same-scale' });
  const negative = buildActionReward({ actionType: 'manual-contribution', seed: 'same-scale', direction: 'negative' });
  assert.equal(Math.abs(negative.contribution), positive.contributionMagnitude);
  assert.ok(negative.contribution <= 0);
  assert.equal(negative.coins, 0);
});
