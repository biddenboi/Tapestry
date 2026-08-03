import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./GoalTiers.js', import.meta.url), 'utf8');
const tiers = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('goal-tier policy has one deterministic source of truth', () => {
  assert.equal(tiers.GOAL_TIERS.length, 10);
  assert.equal(tiers.getGoalTier(0).label, 'Foundation');
  assert.equal(tiers.getGoalTier(100).label, 'Signal');
  assert.equal(tiers.getGoalTier(10000).label, 'Mythic');
  assert.equal(tiers.getGoalTierProgress(175).progress, 50);
  assert.equal(tiers.getUnlockedGoalTierPerks(2).length, 2);
});
