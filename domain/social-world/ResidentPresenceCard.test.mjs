import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESIDENT_CARD_ACTIVITY_KEYS,
  RESIDENT_CARD_IDENTITY_KEYS,
  RESIDENT_CARD_KEYS,
  RESIDENT_CARD_NAVIGATION_KEYS,
  assertResidentPresenceCard,
  buildResidentOccupant,
  buildResidentPresenceCard,
} from './ResidentPresenceCard.js';
import {
  OCCUPANT_KIND,
  RESIDENT_TIME_BASIS,
} from './ResidentSubstitutionContracts.js';
import { SEMANTIC_LOCATION } from './SocialWorldContracts.js';

test('resident cards expose exactly public identity, activity category, time basis, and navigation', () => {
  const card = buildResidentPresenceCard({
    identity: {
      UUID: 'resident-1',
      username: 'Avery',
      profilePicture: 'avatar.png',
      title: 'Trailkeeper',
      frame: { kind: 'earned' },
      theme: 'midnight',
      rankGroup: 'Ascendant',
      elo: 1_900,
      description: 'Must not be copied',
    },
    activityCategory: SEMANTIC_LOCATION.taskSession,
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
    objective: 'Must be ignored',
  });

  assert.deepEqual(Object.keys(card), RESIDENT_CARD_KEYS);
  assert.deepEqual(Object.keys(card.identity), RESIDENT_CARD_IDENTITY_KEYS);
  assert.deepEqual(Object.keys(card.activity), RESIDENT_CARD_ACTIVITY_KEYS);
  assert.deepEqual(Object.keys(card.navigation), RESIDENT_CARD_NAVIGATION_KEYS);
  assert.equal(card.identity.elo, undefined);
  assert.equal(card.identity.rankGroup, 'Ascendant');
  assert.equal(card.identity.rankLabel, undefined);
  assert.equal(card.identity.description, undefined);
  assert.equal(card.activity.objective, undefined);
  assert.deepEqual(card.navigation, { type: 'stranger-profile', profileId: 'resident-1' });
  assert.equal(assertResidentPresenceCard(card), true);
  assert.equal(Object.isFrozen(card), true);
  assert.equal(Object.isFrozen(card.identity), true);
});

test('resident card construction rejects missing identities, generic activity, and familiar time basis', () => {
  assert.throws(() => buildResidentPresenceCard({
    identity: {},
    activityCategory: SEMANTIC_LOCATION.dojo,
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
  }), /requires a public profile identity/);
  assert.throws(() => buildResidentPresenceCard({
    identity: { UUID: 'resident-1' },
    activityCategory: SEMANTIC_LOCATION.commons,
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
  }), /Unsupported resident activity category/);
  assert.throws(() => buildResidentPresenceCard({
    identity: { UUID: 'resident-1' },
    activityCategory: SEMANTIC_LOCATION.dojo,
    timeBasis: RESIDENT_TIME_BASIS.familiar,
  }), /Unsupported resident time basis/);
});

test('resident card assertion rejects additional continuity or comparison fields', () => {
  const card = buildResidentPresenceCard({
    identity: { UUID: 'resident-1', username: 'Avery' },
    activityCategory: SEMANTIC_LOCATION.dojo,
    timeBasis: RESIDENT_TIME_BASIS.viewerIGT,
  });
  assert.throws(() => assertResidentPresenceCard({ ...card, today: { tasks: 2 } }), /outside/);
  assert.throws(() => assertResidentPresenceCard({
    ...card,
    identity: { ...card.identity, elo: 1_000 },
  }), /outside/);
  assert.throws(() => assertResidentPresenceCard({
    ...card,
    activity: { ...card.activity, objective: 'Private task' },
  }), /outside/);
});

test('resident occupants retain the narrow card and never inherit a relationship role', () => {
  const card = buildResidentPresenceCard({
    identity: { UUID: 'resident-1', username: 'Avery' },
    activityCategory: SEMANTIC_LOCATION.matchArena,
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
  });
  const occupant = buildResidentOccupant(card, { state: 'current' });
  assert.equal(occupant.kind, OCCUPANT_KIND.resident);
  assert.equal(occupant.relationshipRole, undefined);
  assert.equal(occupant.residentCard, card);
});
