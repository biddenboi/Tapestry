import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../constants.js';
import { PROFILE_VISIBILITY_POLICY } from './ProfileVisibility.js';
import { buildProfilePresenceCard } from './ProfilePresenceCard.js';
import {
  CAST_ROLE,
  PRESENCE_CLAIM,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
  VISIBILITY_TIER,
} from './SocialWorldContracts.js';

const identity = {
  profileId: 'subject',
  username: 'Subject',
  elo: 700,
  hasVisibleRating: true,
};
const presence = {
  state: PRESENCE_STATE.current,
  location: SEMANTIC_LOCATION.dojo,
  claim: PRESENCE_CLAIM.exactCurrent,
  elapsedHere: 45_000,
  activeElapsed: 30_000,
  lastActiveIGT: DAY + 30_000,
};

test('dynamic cards expose a bounded recent model without settings or exact last-active IGT', () => {
  const card = buildProfilePresenceCard({
    identity,
    role: CAST_ROLE.nearPeer,
    access: { tier: VISIBILITY_TIER.dynamic, ...PROFILE_VISIBILITY_POLICY[VISIBILITY_TIER.dynamic] },
    presence,
    today: { tasks: 3, points: 540, activeMs: 90_000 },
    thread: { projectId: 'project-1', label: 'World audit', evidenceCount: 4 },
    next: [
      { id: 'due', label: 'Review the route', dueAt: '2026-07-15T00:00:00.000Z', explicitCommitment: true },
      { id: 'inferred', label: 'Maybe continue', dueAt: '2026-07-16T00:00:00.000Z' },
    ],
    viewerIGT: DAY + 60_000,
  });

  assert.equal(card.identity.rankLabel, 'GOLD I');
  assert.equal(card.today.dayIndex, 1);
  assert.equal(card.thread.state, 'continuing');
  assert.deepEqual(card.next.map((entry) => entry.id), ['due']);
  assert.deepEqual(card.new, { count: 0, preview: [], facts: [], groups: [], previousEncounter: null });
  assert.equal(card.actions.daybookScope, 'recent');
  assert.equal(card.actions.canOpenSettings, false);
  assert.equal(card.lastActive.inGameTimestamp, null);
});

test('friends receive exact meaningful last-active boundaries while novelty stays empty', () => {
  const card = buildProfilePresenceCard({
    identity,
    role: CAST_ROLE.friend,
    access: { tier: VISIBILITY_TIER.friend, ...PROFILE_VISIBILITY_POLICY[VISIBILITY_TIER.friend] },
    presence: { ...presence, state: PRESENCE_STATE.recent },
    viewerIGT: DAY + 60_000,
  });
  assert.equal(card.lastActive.inGameTimestamp, DAY + 30_000);
  assert.equal(card.lastActive.label, 'Last active DAY 2 · 00:00');
  assert.equal(card.new.count, 0);
});

test('outside-cast subjects fail closed instead of receiving a compact drawer', () => {
  assert.equal(buildProfilePresenceCard({
    identity,
    access: { tier: VISIBILITY_TIER.outside, ...PROFILE_VISIBILITY_POLICY[VISIBILITY_TIER.outside] },
    presence,
    viewerIGT: DAY,
  }), null);
});
