import assert from 'node:assert/strict';
import test from 'node:test';
import { soundForRewardItems } from './AppSounds.js';

test('reward sound classifier maps major action sources to distinct cues', () => {
  assert.equal(soundForRewardItems([{ amount: 1, kind: 'coins' }], { source: 'shop' }), 'purchase');
  assert.equal(soundForRewardItems([{ amount: 12, kind: 'points' }], { source: 'task-results' }), 'task-complete');
  assert.equal(soundForRewardItems([{ amount: 4, unit: 'coins', kind: 'coins', label: '+4 bonus coins' }]), 'roll');
  assert.equal(soundForRewardItems([{ label: 'Achievement: First win', kind: 'contribution' }]), 'achievement');
  assert.equal(soundForRewardItems([{ amount: -5, kind: 'event-penalty' }]), 'warning');
  assert.equal(soundForRewardItems([{ amount: 8, kind: 'contribution' }]), 'contribution');
});

test('match-end reward float stays silent for explicit victory and defeat stingers', () => {
  assert.equal(soundForRewardItems([{ label: '+300 match point diff', kind: 'points' }], { source: 'match-end' }), null);
});
