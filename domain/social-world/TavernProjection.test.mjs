import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaverns } from './TavernProjection.js';
import {
  CAST_ROLE,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

function member(profileId, role, state, location) {
  return {
    profileId,
    role,
    identity: { username: profileId },
    presence: { state, location },
  };
}

test('two live Dojo occupants form one stable Tavern including Self', () => {
  const taverns = buildTaverns([
    member('dynamic', CAST_ROLE.nearPeer, PRESENCE_STATE.projected, SEMANTIC_LOCATION.dojo),
    member('viewer', CAST_ROLE.self, PRESENCE_STATE.current, SEMANTIC_LOCATION.dojo),
  ]);
  assert.equal(taverns.length, 1);
  assert.equal(taverns[0].id, 'tavern:dojo');
  assert.equal(taverns[0].count, 2);
  assert.deepEqual(taverns[0].occupants.map((entry) => entry.profileId), ['viewer', 'dynamic']);
});

test('a Tavern dissolves when one live occupant remains', () => {
  assert.deepEqual(buildTaverns([
    member('viewer', CAST_ROLE.self, PRESENCE_STATE.current, SEMANTIC_LOCATION.dojo),
    member('friend', CAST_ROLE.friend, PRESENCE_STATE.inactive, SEMANTIC_LOCATION.dojo),
  ]), []);
});

test('recent and inactive last-known locations never form Taverns', () => {
  assert.deepEqual(buildTaverns([
    member('friend-a', CAST_ROLE.friend, PRESENCE_STATE.recent, SEMANTIC_LOCATION.commons),
    member('friend-b', CAST_ROLE.friend, PRESENCE_STATE.inactive, SEMANTIC_LOCATION.commons),
  ]), []);
});

test('multiple Taverns retain semantic IDs and deterministic cast order', () => {
  const taverns = buildTaverns([
    member('horizon', CAST_ROLE.horizon, PRESENCE_STATE.projected, SEMANTIC_LOCATION.matchArena),
    member('near', CAST_ROLE.nearPeer, PRESENCE_STATE.projected, SEMANTIC_LOCATION.matchArena),
    member('friend', CAST_ROLE.friend, PRESENCE_STATE.projected, SEMANTIC_LOCATION.planning),
    member('viewer', CAST_ROLE.self, PRESENCE_STATE.current, SEMANTIC_LOCATION.planning),
  ]);
  assert.deepEqual(taverns.map((entry) => entry.id), ['tavern:match-arena', 'tavern:planning']);
  assert.deepEqual(taverns[0].occupants.map((entry) => entry.profileId), ['near', 'horizon']);
  assert.deepEqual(taverns[1].occupants.map((entry) => entry.profileId), ['viewer', 'friend']);
});
