import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSocialWorldScene,
  withLiveViewerPresence,
} from './SocialWorldScene.js';
import {
  CAST_ROLE,
  PRESENCE_CLAIM,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

const presence = (state, location) => ({
  state,
  location,
  claim: state === PRESENCE_STATE.current ? PRESENCE_CLAIM.exactCurrent : PRESENCE_CLAIM.recordedInterval,
  startedIGT: 100,
  endedIGT: null,
  elapsedHere: 900,
  activeElapsed: null,
  lastActiveIGT: 1_000,
  paused: false,
});

test('the prepared scene places only supported presence claims on stable semantic locations', () => {
  const scene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 1_000,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: {
      friends: [{ id: 'friend', profile: { UUID: 'friend', username: 'Friend' } }],
      dynamic: [
        { subjectId: 'near', role: CAST_ROLE.nearPeer, profile: { UUID: 'near', username: 'Near' } },
        { subjectId: 'horizon', role: CAST_ROLE.horizon, profile: { UUID: 'horizon', username: 'Horizon' } },
      ],
      emptyFriendSlots: 2,
    },
    presences: {
      viewer: presence(PRESENCE_STATE.current, SEMANTIC_LOCATION.commons),
      near: presence(PRESENCE_STATE.projected, SEMANTIC_LOCATION.taskSession),
      horizon: presence(PRESENCE_STATE.projected, SEMANTIC_LOCATION.dojo),
    },
    sourceVersions: { presence: 3, socialWorld: 4 },
  });

  assert.equal(scene.viewer.clockLabel, 'DAY 1 · 00:00');
  assert.deepEqual(scene.locations.find((location) => location.id === SEMANTIC_LOCATION.commons).occupants, ['viewer']);
  assert.deepEqual(scene.locations.find((location) => location.id === SEMANTIC_LOCATION.taskSession).occupants, ['near']);
  assert.deepEqual(scene.locations.find((location) => location.id === SEMANTIC_LOCATION.dojo).occupants, ['horizon']);
  assert.deepEqual(scene.inactiveMembers, ['friend']);
  assert.equal(scene.memberById.get('friend').role, CAST_ROLE.friend);
  assert.equal(scene.emptyFriendSlots, 2);
});

test('inactive evidence never leaves a profile on a stale semantic node', () => {
  const scene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 4_000_000,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: {
      friends: [],
      dynamic: [{ subjectId: 'near', role: CAST_ROLE.nearPeer, profile: { UUID: 'near', username: 'Near' } }],
    },
    presences: {
      near: { state: PRESENCE_STATE.inactive, location: SEMANTIC_LOCATION.dojo },
    },
  });
  assert.equal(scene.locations.every((location) => !location.occupants.includes('near')), true);
  assert.deepEqual([...scene.inactiveMembers].sort(), ['near', 'viewer']);
});

test('recent traces move to the inactive partition and cannot occupy a live node', () => {
  const scene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 10_000,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: {
      friends: [{ id: 'friend', profile: { UUID: 'friend', username: 'Friend' } }],
      dynamic: [],
    },
    presences: {
      viewer: presence(PRESENCE_STATE.current, SEMANTIC_LOCATION.commons),
      friend: { ...presence(PRESENCE_STATE.recent, SEMANTIC_LOCATION.dojo), endedIGT: 9_000 },
    },
  });
  assert.equal(scene.locations.every((location) => !location.occupants.includes('friend')), true);
  assert.deepEqual(scene.inactiveMembers, ['friend']);
});

test('live app state overrides the viewer crossing a historical Planning interval', () => {
  const historicalScene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 51_936_697,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: { friends: [], dynamic: [] },
    presences: {
      viewer: {
        ...presence(PRESENCE_STATE.projected, SEMANTIC_LOCATION.planning),
        startedIGT: 51_936_697,
        endedIGT: 51_950_955,
      },
    },
  });

  assert.deepEqual(
    historicalScene.locations.find((item) => item.id === SEMANTIC_LOCATION.planning).occupants,
    ['viewer'],
  );

  const liveScene = withLiveViewerPresence(historicalScene, {
    profileId: 'viewer',
    location: SEMANTIC_LOCATION.commons,
    viewerIGT: 51_936_697,
  });
  const liveViewer = liveScene.memberById.get('viewer');

  assert.equal(liveViewer.presence.state, PRESENCE_STATE.current);
  assert.equal(liveViewer.presence.location, SEMANTIC_LOCATION.commons);
  assert.equal(liveViewer.presence.claim, PRESENCE_CLAIM.exactCurrent);
  assert.equal(liveViewer.presence.sourceType, 'live-app-state');
  assert.deepEqual(
    liveScene.locations.find((item) => item.id === SEMANTIC_LOCATION.planning).occupants,
    [],
  );
  assert.deepEqual(
    liveScene.locations.find((item) => item.id === SEMANTIC_LOCATION.commons).occupants,
    ['viewer'],
  );
  assert.equal(liveScene.inactiveMembers.includes('viewer'), false);
});

test('live app state keeps the viewer in Commons after historical presence becomes Away', () => {
  const historicalScene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 51_951_000,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: { friends: [], dynamic: [] },
    presences: {
      viewer: {
        state: PRESENCE_STATE.recent,
        location: SEMANTIC_LOCATION.planning,
        claim: PRESENCE_CLAIM.recentInterval,
        startedIGT: 51_936_697,
        endedIGT: 51_950_955,
        lastActiveIGT: 51_950_955,
      },
    },
  });

  assert.equal(historicalScene.inactiveMembers.includes('viewer'), true);

  const liveScene = withLiveViewerPresence(historicalScene, {
    profileId: 'viewer',
    location: SEMANTIC_LOCATION.commons,
    viewerIGT: 51_951_000,
  });

  assert.equal(liveScene.memberById.get('viewer').presence.state, PRESENCE_STATE.current);
  assert.deepEqual(
    liveScene.locations.find((item) => item.id === SEMANTIC_LOCATION.commons).occupants,
    ['viewer'],
  );
  assert.equal(liveScene.inactiveMembers.includes('viewer'), false);
});

test('live viewer presence retains the exact ordinary panel while remaining in Commons', () => {
  const historicalScene = buildSocialWorldScene({
    viewerId: 'viewer',
    viewerIGT: 52_000_000,
    viewerProfile: { UUID: 'viewer', username: 'Viewer' },
    residency: { friends: [], dynamic: [] },
    presences: {
      viewer: presence(PRESENCE_STATE.current, SEMANTIC_LOCATION.commons),
    },
  });

  const liveScene = withLiveViewerPresence(historicalScene, {
    profileId: 'viewer',
    location: SEMANTIC_LOCATION.commons,
    viewerIGT: 52_000_000,
    sourceType: 'panel',
    sourceId: 'feed',
  });
  const liveViewer = liveScene.memberById.get('viewer');

  assert.equal(liveViewer.presence.location, SEMANTIC_LOCATION.commons);
  assert.equal(liveViewer.presence.sourceType, 'panel');
  assert.equal(liveViewer.presence.sourceId, 'feed');
  assert.match(liveViewer.presence.presentation.primary, /Viewing Feed/);
});
