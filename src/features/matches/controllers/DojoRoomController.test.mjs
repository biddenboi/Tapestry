import assert from 'node:assert/strict';
import test from 'node:test';
import DojoRoomController from './DojoRoomController.js';
import {
  CAST_ROLE,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from '../../../domain/social-world/SocialWorldContracts.js';

test('the room controller performs one gateway join for the selected cast', async () => {
  const calls = [];
  const controller = new DojoRoomController({
    gateway: {
      async getDojoRoomFacts(query) {
        calls.push(query);
        return [{ profileId: 'viewer', sessionId: 'dojo-live', sessionPoints: 5 }];
      },
    },
  });
  const scene = {
    viewer: { profileId: 'viewer', inGameTime: 500 },
    members: [{
      profileId: 'viewer',
      role: CAST_ROLE.self,
      identity: { profileId: 'viewer' },
      presence: {
        state: PRESENCE_STATE.current,
        location: SEMANTIC_LOCATION.dojo,
        startedIGT: 100,
        endedIGT: null,
        sourceId: 'scene-session',
      },
    }],
  };
  const facts = await controller.load({ scene, viewerIGT: 500, dojoSessionUUID: 'dojo-live' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].occupants, [{ profileId: 'viewer', sessionId: 'dojo-live' }]);
  assert.equal(facts[0].sessionPoints, 5);
});
