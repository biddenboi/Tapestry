import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessProfileTab, filterProfileOverviewBlocks, resolveProfileVisibility } from './ProfileVisibility.js';

test('profile visibility resolves self, friend, dynamic, and outside tiers in priority order', () => {
  const base = { viewerId: 'viewer', friendIds: ['friend'], dynamicProfileIds: ['friend', 'dynamic'], friendCount: 1 };
  assert.equal(resolveProfileVisibility({ ...base, profileId: 'viewer' }).tier, 'self');
  assert.equal(resolveProfileVisibility({ ...base, profileId: 'friend' }).tier, 'friend');
  assert.equal(resolveProfileVisibility({ ...base, profileId: 'dynamic' }).tier, 'dynamic');
  assert.equal(resolveProfileVisibility({ ...base, profileId: 'outside' }).tier, 'outside');
});

test('outside profiles expose Overview only while switching to them restores full self access immediately', () => {
  const outside = resolveProfileVisibility({ viewerId: 'viewer', profileId: 'outside' });
  assert.deepEqual(outside.allowedTabs, ['overview']);
  assert.equal(canAccessProfileTab(outside, 'timeline'), false);
  assert.deepEqual(filterProfileOverviewBlocks({ blocks: [
    { type: 'text' }, { type: 'activity' }, { type: 'stats' }, { type: 'rankGraph' },
  ] }, outside).blocks.map((block) => block.type), ['text']);

  const switched = resolveProfileVisibility({ viewerId: 'outside', profileId: 'outside' });
  assert.equal(switched.tier, 'self');
  assert.equal(canAccessProfileTab(switched, 'identity'), true);
  assert.equal(switched.daybookScope, 'full');
});

test('dynamic access is a recent Daybook and match summary, never unrestricted tabs', () => {
  const access = resolveProfileVisibility({ viewerId: 'viewer', profileId: 'dynamic', dynamicProfileIds: ['dynamic'] });
  assert.equal(access.daybookScope, 'recent');
  assert.equal(access.matchScope, 'summary');
  assert.equal(canAccessProfileTab(access, 'social'), false);
  assert.equal(canAccessProfileTab(access, 'settings'), false);
});
