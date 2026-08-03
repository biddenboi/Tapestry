import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertResidentOccupancySnapshot,
  buildPrimaryFamiliarSlots,
  buildPrimaryOnlyOccupancySnapshot,
  isFamiliarSlotSubstitutable,
  isFreshLivePresence,
  isPrimaryFamiliarRepresentable,
} from './ResidentSubstitutionPolicy.js';
import { buildResidentOccupant, buildResidentPresenceCard } from './ResidentPresenceCard.js';
import {
  RESIDENT_MODE,
  RESIDENT_TIME_BASIS,
} from './ResidentSubstitutionContracts.js';
import {
  CAST_ROLE,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

const friend = (profileId, friendshipId = `link-${profileId}`) => ({
  id: profileId,
  relationship: { UUID: friendshipId, status: 'accepted' },
  profile: { UUID: profileId, username: profileId },
});

const dynamic = (profileId, role) => ({
  subjectId: profileId,
  role,
  profile: { UUID: profileId, username: profileId },
});

test('primary familiar slots preserve populated relationship ownership and stable capacity', () => {
  const slots = buildPrimaryFamiliarSlots({
    friends: [friend('friend-a'), friend('friend-b'), friend('friend-c')],
    dynamic: [
      dynamic('near', CAST_ROLE.nearPeer),
      dynamic('horizon', CAST_ROLE.horizon),
    ],
    emptyFriendSlots: 0,
  });
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map((slot) => slot.slotId), [
    'friendship:link-friend-a',
    'friendship:link-friend-b',
    'friendship:link-friend-c',
    'cast:near-peer',
    'cast:horizon',
  ]);
  assert.deepEqual(slots.map((slot) => slot.primaryFamiliarId), [
    'friend-a', 'friend-b', 'friend-c', 'near', 'horizon',
  ]);
  assert.equal(Object.isFrozen(slots), true);
  assert.equal(Object.isFrozen(slots[0]), true);
});

test('vacant capacity does not create anonymous relationship slots', () => {
  const slots = buildPrimaryFamiliarSlots({
    friends: [friend('friend-a')],
    dynamic: [],
    emptyFriendSlots: 2,
  });
  assert.deepEqual(slots.map((slot) => slot.slotId), ['friendship:link-friend-a']);
});

test('duplicate familiars and capacity overflow fail loudly or fail closed', () => {
  assert.throws(() => buildPrimaryFamiliarSlots({
    friends: [friend('same')],
    dynamic: [dynamic('same', CAST_ROLE.nearPeer)],
  }), (error) => error.code === 'duplicate-primary-familiar');

  const oversized = {
    friends: Array.from({ length: 6 }, (_, index) => friend(`friend-${index}`)),
  };
  assert.throws(() => buildPrimaryFamiliarSlots(oversized), (error) => (
    error.code === 'capacity-violation' && error.details.maximum === 5
  ));
  const diagnostics = [];
  const bounded = buildPrimaryFamiliarSlots(oversized, {
    strict: false,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  assert.equal(bounded.length, 5);
  assert.equal(diagnostics.at(-1).code, 'capacity-violation');
});

test('Full mode uses the fixed freshness and familiar interruption grace boundaries', () => {
  const now = Date.UTC(2026, 6, 14, 12, 0, 0);
  assert.equal(isFreshLivePresence({ observedAtMs: now - 45_000 }, now), true);
  assert.equal(isFreshLivePresence({ observedAtMs: now - 45_001 }, now), false);
  assert.equal(isPrimaryFamiliarRepresentable({
    mode: RESIDENT_MODE.fullLive,
    livePresence: { observedAtMs: now - 60_000, paused: true },
    nowMs: now,
  }), true);
  assert.equal(isFamiliarSlotSubstitutable({
    mode: RESIDENT_MODE.fullLive,
    livePresence: { observedAtMs: now - 60_001 },
    nowMs: now,
  }), true);
  assert.equal(isFamiliarSlotSubstitutable({
    mode: RESIDENT_MODE.fullLive,
    liveEvidenceResolved: false,
    nowMs: now,
  }), false);
});

test('aligned mode preserves current, projected, and recent familiar coverage', () => {
  for (const state of [PRESENCE_STATE.current, PRESENCE_STATE.projected, PRESENCE_STATE.recent]) {
    assert.equal(isFamiliarSlotSubstitutable({
      mode: RESIDENT_MODE.inGameTimeAligned,
      alignedPresence: { state },
    }), false, state);
  }
  assert.equal(isFamiliarSlotSubstitutable({
    mode: RESIDENT_MODE.inGameTimeAligned,
    alignedPresence: { state: PRESENCE_STATE.inactive },
  }), true);
  assert.equal(isFamiliarSlotSubstitutable({
    mode: RESIDENT_MODE.inGameTimeAligned,
    alignedPresence: null,
    alignedEvidenceResolved: false,
  }), false);
  assert.equal(isFamiliarSlotSubstitutable({ mode: RESIDENT_MODE.off }), false);
});

test('primary-only snapshots preserve ownership and resident snapshot assertions enforce uniqueness', () => {
  const primarySlots = buildPrimaryFamiliarSlots({
    friends: [friend('friend-a')],
    dynamic: [dynamic('near', CAST_ROLE.nearPeer)],
  });
  const snapshot = buildPrimaryOnlyOccupancySnapshot({
    viewerId: 'viewer',
    viewerIGT: 4_200,
    mode: RESIDENT_MODE.inGameTimeAligned,
    primarySlots,
    resolvedAt: '2026-07-14T12:00:00.000Z',
  });
  assert.equal(assertResidentOccupancySnapshot(snapshot), true);
  assert.deepEqual(snapshot.slots.map((slot) => slot.occupant.profileId), ['friend-a', 'near']);

  const residentCard = buildResidentPresenceCard({
    identity: { UUID: 'stranger', username: 'Stranger' },
    activityCategory: SEMANTIC_LOCATION.dojo,
    timeBasis: RESIDENT_TIME_BASIS.viewerIGT,
  });
  const residentSnapshot = {
    ...snapshot,
    slots: [{
      ...snapshot.slots[0],
      occupant: buildResidentOccupant(residentCard, { state: PRESENCE_STATE.projected }),
    }],
  };
  assert.equal(assertResidentOccupancySnapshot(residentSnapshot), true);
  assert.throws(() => assertResidentOccupancySnapshot({
    ...residentSnapshot,
    slots: [...residentSnapshot.slots, { ...residentSnapshot.slots[0] }],
  }), /invalid/);
});

test('resident substitution policy remains downstream of Dynamic Cast selection', async () => {
  const policy = await readFile(new URL('./ResidentSubstitutionPolicy.js', import.meta.url), 'utf8');
  const castService = await readFile(
    new URL('../../data/persistence/services/SocialWorldCastService.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(policy, /DynamicCastSelection|buildDynamicCastReview|getDynamicCast/);
  assert.doesNotMatch(castService, /ResidentSubstitution|ResidentOccupancy|ResidentCandidate/);
});

