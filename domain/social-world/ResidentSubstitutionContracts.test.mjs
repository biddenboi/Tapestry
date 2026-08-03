import assert from 'node:assert/strict';
import test from 'node:test';
import { CAST_ROLE, SEMANTIC_LOCATION } from './SocialWorldContracts.js';
import {
  OCCUPANT_KIND,
  RESIDENT_ACTIVITY_CATEGORY,
  RESIDENT_MODE,
  RESIDENT_RELATIONSHIP_ROLES,
  RESIDENT_SLOT_PREFIX,
  RESIDENT_SUBSTITUTION_LIMITS,
  RESIDENT_TIME_BASIS,
  isOccupantKind,
  isResidentActivityCategory,
  isResidentMode,
  isResidentRelationshipRole,
  isResidentSlotId,
  isResidentTimeBasis,
  residentModeAllowsCandidateRetrieval,
} from './ResidentSubstitutionContracts.js';

test('resident substitution vocabulary and launch values are immutable', () => {
  assert.deepEqual(Object.values(RESIDENT_MODE), [
    'full-live',
    'in-game-time-aligned',
    'off',
  ]);
  assert.deepEqual(Object.values(OCCUPANT_KIND), ['familiar', 'resident']);
  assert.deepEqual(Object.values(RESIDENT_TIME_BASIS), [
    'familiar',
    'live-wall-clock',
    'viewer-igt',
  ]);
  assert.equal(Object.isFrozen(RESIDENT_MODE), true);
  assert.equal(Object.isFrozen(RESIDENT_SUBSTITUTION_LIMITS), true);
  assert.equal(RESIDENT_SUBSTITUTION_LIMITS.maxSurroundingProfiles, 5);
  assert.equal(RESIDENT_SUBSTITUTION_LIMITS.liveFreshnessMs, 45_000);
  assert.equal(RESIDENT_SUBSTITUTION_LIMITS.familiarOfflineGraceMs, 15_000);
  assert.equal(RESIDENT_SUBSTITUTION_LIMITS.presentationLeaseMs, 300_000);
});

test('resident vocabulary validators reject unknown values', () => {
  assert.equal(isResidentMode(RESIDENT_MODE.fullLive), true);
  assert.equal(isResidentMode('automatic'), false);
  assert.equal(isOccupantKind(OCCUPANT_KIND.resident), true);
  assert.equal(isOccupantKind('comparison'), false);
  assert.equal(isResidentTimeBasis(RESIDENT_TIME_BASIS.viewerIGT), true);
  assert.equal(isResidentTimeBasis('local-time'), false);
});

test('launch activity policy requires a specific semantic activity', () => {
  assert.deepEqual(Object.values(RESIDENT_ACTIVITY_CATEGORY), Object.values(SEMANTIC_LOCATION));
  assert.equal(isResidentActivityCategory(SEMANTIC_LOCATION.taskSession), true);
  assert.equal(isResidentActivityCategory(SEMANTIC_LOCATION.commons), false);
  assert.equal(isResidentActivityCategory(SEMANTIC_LOCATION.commons, { allowGenericActive: true }), true);
  assert.equal(isResidentActivityCategory('sleeping'), false);
});

test('only populated friendship and comparison slot identifiers are valid', () => {
  assert.equal(isResidentSlotId(`${RESIDENT_SLOT_PREFIX.friendship}friendship-1`), true);
  assert.equal(isResidentSlotId(`${RESIDENT_SLOT_PREFIX.cast}${CAST_ROLE.nearPeer}`), true);
  assert.equal(isResidentSlotId(`${RESIDENT_SLOT_PREFIX.cast}${CAST_ROLE.horizon}`), true);
  assert.equal(isResidentSlotId(RESIDENT_SLOT_PREFIX.friendship), false);
  assert.equal(isResidentSlotId(`${RESIDENT_SLOT_PREFIX.cast}${CAST_ROLE.friend}`), false);
  assert.deepEqual(RESIDENT_RELATIONSHIP_ROLES, [
    CAST_ROLE.friend,
    CAST_ROLE.nearPeer,
    CAST_ROLE.horizon,
  ]);
  assert.equal(isResidentRelationshipRole(CAST_ROLE.self), false);
});

test('Off bypasses resident candidate retrieval independently of outbound consent', () => {
  assert.equal(residentModeAllowsCandidateRetrieval(RESIDENT_MODE.off), false);
  assert.equal(residentModeAllowsCandidateRetrieval(RESIDENT_MODE.fullLive), true);
  assert.equal(residentModeAllowsCandidateRetrieval(RESIDENT_MODE.inGameTimeAligned), true);
  assert.equal(residentModeAllowsCandidateRetrieval('unknown'), false);
});
