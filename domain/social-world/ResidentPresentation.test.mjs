import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOccupantAccessibleName,
  residentActivityLabel,
} from './ResidentPresenceCard.js';

test('resident activity labels are centralized and generic active is disabled by default', () => {
  assert.equal(residentActivityLabel('planning'), 'Planning');
  assert.equal(residentActivityLabel('task-session'), 'Task Session');
  assert.equal(residentActivityLabel('dojo'), 'Dojo');
  assert.equal(residentActivityLabel('match-arena'), 'Match');
  assert.equal(residentActivityLabel('marketplace'), 'Marketplace');
  assert.equal(residentActivityLabel('commons'), null);
  assert.equal(residentActivityLabel('commons', { allowGenericActive: true }), 'Active');
});

test('resident accessible names state stranger status, activity, time basis, and public navigation', () => {
  assert.equal(buildOccupantAccessibleName({
    name: 'Avery',
    occupantKind: 'resident',
    timeBasis: 'live-wall-clock',
    activityCategory: 'dojo',
  }), 'Avery, unfamiliar player, live in Dojo. Open public profile.');
  assert.equal(buildOccupantAccessibleName({
    identity: { username: 'Morgan' },
    occupantKind: 'resident',
    timeBasis: 'viewer-igt',
    residentCard: { activity: { category: 'match-arena' } },
  }), 'Morgan, unfamiliar player, in Match at your current in-game time. Open public profile.');
});
