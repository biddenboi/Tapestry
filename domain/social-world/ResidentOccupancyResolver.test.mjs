import assert from 'node:assert/strict';
import test from 'node:test';
import { CAST_ROLE, PRESENCE_STATE, SEMANTIC_LOCATION } from './SocialWorldContracts.js';
import {
  OCCUPANT_KIND,
  RESIDENT_MODE,
  RESIDENT_TIME_BASIS,
} from './ResidentSubstitutionContracts.js';
import { resolveResidentOccupancy } from './ResidentOccupancyResolver.js';

const NOW = new Date('2026-07-14T18:00:00.000Z').getTime();

function slot(index) {
  const profileId = `familiar-${index}`;
  return Object.freeze({
    slotId: `friendship:relationship-${index}`,
    relationshipRole: CAST_ROLE.friend,
    primaryFamiliarId: profileId,
    primaryFamiliar: Object.freeze({
      profileId,
      profile: Object.freeze({ UUID: profileId, username: `Familiar ${index}` }),
    }),
  });
}

function candidate(index, { observedAgeMs = 1_000, expiresInMs = 44_000 } = {}) {
  const profileId = `resident-${index}`;
  return Object.freeze({
    profileId,
    identity: Object.freeze({
      profileId,
      username: `Resident ${index}`,
      profilePicture: null,
      title: null,
      frame: null,
      theme: null,
    }),
    activity: Object.freeze({ category: SEMANTIC_LOCATION.dojo }),
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
    evidenceId: `evidence-${index}`,
    eligibilityVersion: 'eligibility-v1',
    observedAt: new Date(NOW - observedAgeMs).toISOString(),
    expiresAt: new Date(NOW + expiresInMs).toISOString(),
    validFromIGT: null,
    validThroughIGT: null,
    elapsedHere: 26 * 60_000,
    profileAccessToken: `token-${index}`,
  });
}

function liveFact(ageMs, { paused = false, reclaimConfirmed = false } = {}) {
  return Object.freeze({
    evidenceResolved: true,
    reclaimConfirmed,
    presence: Object.freeze({
      state: PRESENCE_STATE.current,
      location: SEMANTIC_LOCATION.taskSession,
      active: true,
      paused,
      observedAtMs: NOW - ageMs,
      observedAt: new Date(NOW - ageMs).toISOString(),
    }),
  });
}

function resolve(overrides = {}) {
  return resolveResidentOccupancy({
    viewerId: 'viewer',
    viewerIGT: 1_000,
    viewingSessionId: 'session-1',
    primarySlots: [slot(1)],
    familiarFacts: { 'familiar-1': liveFact(60_001) },
    eligibleCandidates: [candidate(1)],
    currentLeases: [],
    mode: RESIDENT_MODE.fullLive,
    nowMs: NOW,
    selectionSeed: 'fixed-seed',
    ...overrides,
  });
}

test('resolver handles zero through five slots without duplicate residents', () => {
  for (let count = 0; count <= 5; count += 1) {
    const primarySlots = Array.from({ length: count }, (_, index) => slot(index));
    const result = resolve({
      primarySlots,
      familiarFacts: Object.fromEntries(primarySlots.map((entry) => [
        entry.primaryFamiliarId,
        liveFact(60_001),
      ])),
      eligibleCandidates: Array.from({ length: count }, (_, index) => candidate(index)),
    });
    assert.equal(result.snapshot.slots.length, count);
    assert.equal(new Set(result.snapshot.slots.map((entry) => entry.occupant.profileId)).size, count);
    assert.equal(result.leases.length, count);
  }
});

test('partial candidate supply fills only resolvable slots and preserves familiar ownership elsewhere', () => {
  const primarySlots = [slot(1), slot(2)];
  const result = resolve({
    primarySlots,
    familiarFacts: {
      'familiar-1': liveFact(60_001),
      'familiar-2': liveFact(60_001),
    },
    eligibleCandidates: [candidate(1)],
  });
  assert.deepEqual(result.snapshot.slots.map((entry) => entry.occupant.kind), [
    OCCUPANT_KIND.resident,
    OCCUPANT_KIND.familiar,
  ]);
  assert.deepEqual(result.snapshot.slots.map((entry) => entry.primaryFamiliarId), [
    'familiar-1',
    'familiar-2',
  ]);
});

test('45-second freshness plus 15-second grace is inclusive and paused familiar presence remains representable', () => {
  assert.equal(resolve({
    familiarFacts: { 'familiar-1': liveFact(60_000) },
  }).snapshot.slots[0].occupant.kind, OCCUPANT_KIND.familiar);
  assert.equal(resolve({
    familiarFacts: { 'familiar-1': liveFact(45_000, { paused: true }) },
  }).snapshot.slots[0].occupant.kind, OCCUPANT_KIND.familiar);
  assert.equal(resolve({
    familiarFacts: { 'familiar-1': liveFact(60_001) },
  }).snapshot.slots[0].occupant.kind, OCCUPANT_KIND.resident);
});

test('incumbency wins after freshness, while a familiar reclaims only after confirmation', () => {
  const incumbent = candidate(2, { observedAgeMs: 14_000 });
  const lease = Object.freeze({
    viewerId: 'viewer',
    viewingSessionId: 'session-1',
    slotId: 'friendship:relationship-1',
    primaryFamiliarId: 'familiar-1',
    residentProfileId: incumbent.profileId,
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
    activityCategory: SEMANTIC_LOCATION.dojo,
    evidenceId: incumbent.evidenceId,
    eligibilityVersion: incumbent.eligibilityVersion,
    leasedAt: new Date(NOW - 20_000).toISOString(),
    verifiedAt: new Date(NOW - 10_000).toISOString(),
    expiresAt: new Date(NOW + 280_000).toISOString(),
  });
  const retained = resolve({
    eligibleCandidates: [candidate(1, { observedAgeMs: 14_000 }), incumbent],
    currentLeases: [lease],
  });
  assert.equal(retained.snapshot.slots[0].occupant.profileId, incumbent.profileId);
  assert.equal(retained.leases[0].leasedAt, lease.leasedAt);

  const pendingReclaim = resolve({
    familiarFacts: { 'familiar-1': liveFact(1_000, { reclaimConfirmed: false }) },
    eligibleCandidates: [incumbent],
    currentLeases: [lease],
  });
  assert.equal(pendingReclaim.snapshot.slots[0].occupant.profileId, incumbent.profileId);
  const reclaimed = resolve({
    familiarFacts: { 'familiar-1': liveFact(1_000, { reclaimConfirmed: true }) },
    eligibleCandidates: [incumbent],
    currentLeases: [lease],
  });
  assert.equal(reclaimed.snapshot.slots[0].occupant.profileId, 'familiar-1');
  assert.equal(reclaimed.leases.length, 0);
});

test('snapshot evidence expiry is independent from the five-minute presentation lease', () => {
  const result = resolve({ eligibleCandidates: [candidate(1, { expiresInMs: 22_000 })] });
  assert.equal(result.snapshot.expiresAt, new Date(NOW + 22_000).toISOString());
  assert.equal(result.leases[0].expiresAt, new Date(NOW + 300_000).toISOString());
  assert.deepEqual(Object.keys(result.snapshot.slots[0].occupant.residentCard.activity), ['category']);
  assert.equal(result.snapshot.slots[0].occupant.presence.elapsedHere, 26 * 60_000);
});

test('unresolved familiar evidence fails closed even when residents are eligible', () => {
  const result = resolve({
    familiarFacts: {
      'familiar-1': Object.freeze({ evidenceResolved: false, presence: null, reclaimConfirmed: false }),
    },
  });
  assert.equal(result.snapshot.slots[0].occupant.kind, OCCUPANT_KIND.familiar);
  assert.equal(result.leases.length, 0);
});

test('a disconnected incumbent keeps only its assignment hint for ten seconds, never its expired card', () => {
  const incumbentLease = {
    viewerId: 'viewer',
    viewingSessionId: 'session-1',
    slotId: 'friendship:relationship-1',
    primaryFamiliarId: 'familiar-1',
    residentProfileId: 'resident-1',
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
    activityCategory: SEMANTIC_LOCATION.dojo,
    evidenceId: 'expired-evidence',
    eligibilityVersion: 'eligibility-v1',
    leasedAt: new Date(NOW - 60_000).toISOString(),
    verifiedAt: new Date(NOW - 10_000).toISOString(),
    expiresAt: new Date(NOW + 240_000).toISOString(),
  };
  const grace = resolve({ eligibleCandidates: [], currentLeases: [incumbentLease] });
  assert.equal(grace.snapshot.slots[0].occupant.kind, OCCUPANT_KIND.familiar);
  assert.equal(grace.leases[0].residentProfileId, 'resident-1');
  const elapsed = resolve({
    eligibleCandidates: [],
    currentLeases: [{ ...incumbentLease, verifiedAt: new Date(NOW - 10_001).toISOString() }],
  });
  assert.equal(elapsed.leases.length, 0);
});
