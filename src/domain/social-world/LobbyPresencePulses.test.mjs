import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLobbyActivityPulses } from './LobbyPresencePulses.js';
import { PRESENCE_STATE, SEMANTIC_LOCATION } from './SocialWorldContracts.js';

const member = (profileId, state, location) => ({
  profileId,
  identity: { profileId, username: profileId },
  presence: { state, location },
});

test('Lobby pulses use only prepared current/projected Match and Dojo claims', () => {
  const scene = {
    members: [
      member('self', PRESENCE_STATE.current, SEMANTIC_LOCATION.commons),
      member('match-current', PRESENCE_STATE.current, SEMANTIC_LOCATION.matchArena),
      member('match-projected', PRESENCE_STATE.projected, SEMANTIC_LOCATION.matchArena),
      member('match-recent', PRESENCE_STATE.recent, SEMANTIC_LOCATION.matchArena),
      member('dojo-current', PRESENCE_STATE.current, SEMANTIC_LOCATION.dojo),
      member('planning', PRESENCE_STATE.projected, SEMANTIC_LOCATION.planning),
    ],
  };
  const pulses = selectLobbyActivityPulses(scene, { excludeProfileId: 'self' });
  assert.deepEqual(pulses.match.map(({ profileId }) => profileId), ['match-current', 'match-projected']);
  assert.deepEqual(pulses.dojo.map(({ profileId }) => profileId), ['dojo-current']);
});

test('Lobby pulses remain bounded to a compact subset of the prepared cast', () => {
  const scene = {
    members: Array.from({ length: 6 }, (_, index) => (
      member(`profile-${index}`, PRESENCE_STATE.projected, SEMANTIC_LOCATION.dojo)
    )),
  };
  const pulses = selectLobbyActivityPulses(scene, { limit: 3 });
  assert.equal(pulses.dojo.length, 3);
  assert.equal(Object.isFrozen(pulses.dojo), true);
});
