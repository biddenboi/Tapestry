import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDojoRoomFactRequest,
  projectDojoRoomRows,
  selectDojoRoomMembers,
} from './DojoRoom.js';
import {
  CAST_ROLE,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

function member(profileId, role, state, overrides = {}) {
  return {
    profileId,
    identity: { profileId, username: profileId },
    role,
    presence: {
      state,
      location: SEMANTIC_LOCATION.dojo,
      startedIGT: 100,
      endedIGT: null,
      elapsedHere: 900,
      activeElapsed: 500,
      sourceId: `${profileId}-session`,
      paused: false,
      ...overrides,
    },
  };
}

function scene() {
  return {
    viewer: { profileId: 'viewer', inGameTime: 1_000 },
    members: [
      member('friend', CAST_ROLE.friend, PRESENCE_STATE.projected, { endedIGT: 1_400 }),
      member('viewer', CAST_ROLE.self, PRESENCE_STATE.current),
      member('left', CAST_ROLE.nearPeer, PRESENCE_STATE.projected, { endedIGT: 1_100 }),
      { ...member('commons', CAST_ROLE.horizon, PRESENCE_STATE.projected), presence: {
        ...member('commons', CAST_ROLE.horizon, PRESENCE_STATE.projected).presence,
        location: SEMANTIC_LOCATION.commons,
      } },
    ],
  };
}

test('room selection is factual, viewer-primary, and ends projected occupancy at its boundary', () => {
  assert.deepEqual(selectDojoRoomMembers(scene(), 1_050).map((row) => row.profileId), [
    'viewer', 'friend', 'left',
  ]);
  assert.deepEqual(selectDojoRoomMembers(scene(), 1_100).map((row) => row.profileId), [
    'viewer', 'friend',
  ]);
});

test('the bounded fact request carries one profile/session pair per occupant', () => {
  assert.deepEqual(buildDojoRoomFactRequest({
    scene: scene(), viewerIGT: 1_100, dojoSessionUUID: 'live-viewer-session',
  }), [
    { profileId: 'viewer', sessionId: 'live-viewer-session' },
    { profileId: 'friend', sessionId: 'friend-session' },
  ]);
});

test('room rows preserve occupancy without invented task evidence and use live viewer task facts', () => {
  const rows = projectDojoRoomRows({
    scene: scene(),
    viewerIGT: 1_200,
    dojoSessionUUID: 'viewer-session',
    viewerSessionPoints: 42,
    liveTaskSnapshot: {
      sourceGameState: 'dojo',
      sourceDojoSessionUUID: 'viewer-session',
      elapsedMs: 700,
      pausedAtMs: 1_180,
      task: { name: 'Deep review' },
    },
    facts: [
      { profileId: 'friend', sessionId: 'friend-session', sessionPoints: 19, taskLabel: null },
      { profileId: 'viewer', sessionId: 'wrong-session', sessionPoints: 999, taskLabel: 'Wrong' },
    ],
  });
  assert.equal(rows[0].profileId, 'viewer');
  assert.equal(rows[0].taskLabel, 'Deep review');
  assert.equal(rows[0].sessionPoints, 42);
  assert.equal(rows[0].focusedMs, 700);
  assert.equal(rows[0].paused, true);
  assert.equal(rows[1].taskLabel, null);
  assert.equal(rows[1].sessionPoints, 19);
  assert.equal(rows[1].elapsedHere, 1_100);
});

test('resident room rows retain only public activity and elapsed time', () => {
  const resident = {
    ...member('resident', CAST_ROLE.friend, PRESENCE_STATE.current, { elapsedHere: 26 * 60_000 }),
    occupantKind: 'resident',
    timeBasis: 'live-wall-clock',
    residentCard: { activity: { category: SEMANTIC_LOCATION.dojo } },
  };
  const [row] = projectDojoRoomRows({
    scene: { viewer: { profileId: 'viewer', inGameTime: 1_000 }, members: [resident] },
    viewerIGT: 1_000,
    facts: [{ profileId: 'resident', sessionPoints: 999, taskLabel: 'Private' }],
  });
  assert.equal(row.elapsedHere, 26 * 60_000);
  assert.equal(row.focusedMs, null);
  assert.equal(row.sessionPoints, null);
  assert.equal(row.taskLabel, null);
});
