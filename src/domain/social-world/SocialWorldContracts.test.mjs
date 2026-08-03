import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CAST_CAPACITY,
  COMPACT_PROFILE_DRAWER_CONTRACT,
  PRESENCE_STATE,
  PRESENCE_SURFACE,
  SEMANTIC_LOCATION,
  SURFACE_ALLOWED_PRESENCE_STATES,
  canSurfaceClaimCurrent,
  canSurfaceRenderPresenceState,
  isMeaningfulActivityKind,
} from './SocialWorldContracts.js';

test('social-world vocabulary is immutable and inactive remains a state, not a location', () => {
  assert.deepEqual(Object.values(PRESENCE_STATE), [
    'current',
    'projected',
    'recent',
    'inactive',
  ]);
  assert.equal(Object.values(SEMANTIC_LOCATION).includes('inactive'), false);
  assert.equal(Object.isFrozen(PRESENCE_STATE), true);
  assert.equal(Object.isFrozen(SURFACE_ALLOWED_PRESENCE_STATES), true);
});

test('cast capacity locks two dynamics, up to three friends, and five surrounding profiles', () => {
  assert.deepEqual(CAST_CAPACITY, {
    dynamicSlots: 2,
    maxFriends: 3,
    maxSurroundingProfiles: 5,
    maxSceneProfilesIncludingSelf: 6,
  });
  assert.equal(CAST_CAPACITY.dynamicSlots + CAST_CAPACITY.maxFriends, 5);
});

test('only evidence-bearing social surfaces may claim current activity', () => {
  assert.equal(canSurfaceClaimCurrent(PRESENCE_SURFACE.semanticScene), true);
  assert.equal(canSurfaceClaimCurrent(PRESENCE_SURFACE.compactDrawer), true);
  assert.equal(canSurfaceClaimCurrent(PRESENCE_SURFACE.inactiveRail), false);
  assert.equal(canSurfaceClaimCurrent(PRESENCE_SURFACE.outsideOverview), false);
  assert.equal(
    canSurfaceRenderPresenceState(PRESENCE_SURFACE.inactiveRail, PRESENCE_STATE.current),
    false,
  );
  assert.equal(
    canSurfaceRenderPresenceState(PRESENCE_SURFACE.inactiveRail, PRESENCE_STATE.recent),
    true,
  );
});

test('compact drawer has the exact bounded Now, Today, Thread, Next, New contract', () => {
  assert.deepEqual(COMPACT_PROFILE_DRAWER_CONTRACT.sectionOrder, [
    'now',
    'today',
    'thread',
    'next',
    'new',
  ]);
  assert.equal(COMPACT_PROFILE_DRAWER_CONTRACT.maxFactsPerSection, 2);
  assert.equal(COMPACT_PROFILE_DRAWER_CONTRACT.sections.next.evidence, 'explicit-only');
  assert.deepEqual(COMPACT_PROFILE_DRAWER_CONTRACT.sections.new.optional, [
    'meaningfulChangeCount',
    'sinceLastEncounterLink',
  ]);
});

test('last-active accepts meaningful semantic boundaries and rejects arbitrary edits', () => {
  assert.equal(isMeaningfulActivityKind('task-session-completed'), true);
  assert.equal(isMeaningfulActivityKind('dojo-entered'), true);
  assert.equal(isMeaningfulActivityKind('record-updated'), false);
  assert.equal(isMeaningfulActivityKind('profile-edited'), false);
});

test('Batch 1 contract code contains no inferred sleep or routine vocabulary', async () => {
  const files = [
    'SocialWorldContracts.js',
    'SemanticLocationPolicy.js',
    'PresenceProjection.js',
  ];
  const source = (await Promise.all(files.map((file) => (
    readFile(new URL(file, import.meta.url), 'utf8')
  )))).join('\n');
  assert.doesNotMatch(source, /\b(sleep(?:ing)?|routine|usually|availability prediction)\b/i);
});
