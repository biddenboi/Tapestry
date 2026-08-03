import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDojoRoomRows } from '../../../domain/social-world/DojoRoom.js';
import { selectLobbyActivityPulses } from '../../../domain/social-world/LobbyPresencePulses.js';
import { PRESENCE_STATE, SEMANTIC_LOCATION } from '../../../domain/social-world/SocialWorldContracts.js';
import SocialWorldProfileCardQueryService from '../services/SocialWorldProfileCardQueryService.js';
import SocialWorldQueryService from '../services/SocialWorldQueryService.js';
import SocialWorldResidencyService from '../services/SocialWorldResidencyService.js';
import SocialWorldSceneQueryService from '../services/SocialWorldSceneQueryService.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-14T18:00:00.000Z');

test('scene, drawer, Lobby, and Dojo consume one interval identity without future leakage', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'viewer', username: 'Viewer', elo: 500, inGameTime: 1_000, createdAt: fixed.toISOString() },
      { UUID: 'friend', username: 'Friend', elo: 520, inGameTime: 2_500, createdAt: fixed.toISOString() },
    ],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.social.requestFriendship({
    friendshipId: 'friendship', requesterId: 'viewer', recipientId: 'friend',
    notificationId: 'friendship-request', operationId: 'friendship-request',
    createdAt: fixed, inGameTimestamp: 400,
  });
  await context.shadow.social.acceptFriendship({
    friendshipId: 'friendship', accepterId: 'friend', notificationId: 'friendship-accepted',
    operationId: 'friendship-accepted', acceptedAt: fixed, inGameTimestamp: 500,
  });
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'friend-dojo', playerId: 'friend', location: SEMANTIC_LOCATION.dojo,
    startedIGT: 800, enteredAt: fixed, sourceType: 'dojo-session', sourceId: 'dojo-1',
    commandId: 'friend-dojo-enter',
  });
  await context.shadow.socialWorld.closePresence({
    playerId: 'friend', endedIGT: 1_200, exitedAt: fixed,
    closeReason: 'completed', commandId: 'friend-dojo-close',
  });
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'friend-future', playerId: 'friend', location: SEMANTIC_LOCATION.commons,
    startedIGT: 2_000, enteredAt: fixed, sourceType: 'surface', sourceId: 'map',
    commandId: 'friend-future-enter',
  });

  const presence = new SocialWorldQueryService({
    repository: context.shadow.socialWorld, client: context.client, now: () => fixed,
  });
  const residency = new SocialWorldResidencyService({
    socialRepository: context.shadow.social, client: context.client,
  });
  const scenes = new SocialWorldSceneQueryService({
    residencyService: residency, presenceQueryService: presence, client: context.client,
  });
  const cards = new SocialWorldProfileCardQueryService({
    residencyService: residency, presenceQueryService: presence, client: context.client,
  });

  const scene = await scenes.getSceneSnapshot({
    viewerId: 'viewer', viewerIGT: 1_000, nowMs: fixed.getTime(),
  });
  const scenePresence = scene.memberById.get('friend').presence;
  const card = await cards.getProfileCard({
    viewerId: 'viewer', profileId: 'friend', viewerIGT: 1_000, nowMs: fixed.getTime(),
  });
  const lobbyPresence = selectLobbyActivityPulses(scene).dojo[0].presence;
  const dojoRow = projectDojoRoomRows({ scene, viewerIGT: 1_000 })[0];

  assert.equal(scenePresence.intervalId, 'friend-dojo');
  assert.equal(card.now.intervalId, scenePresence.intervalId);
  assert.equal(lobbyPresence.intervalId, scenePresence.intervalId);
  assert.equal(dojoRow.presenceIntervalId, scenePresence.intervalId);
  assert.equal(scenePresence.state, PRESENCE_STATE.projected);
  assert.equal(scenePresence.location, SEMANTIC_LOCATION.dojo);

  const beforeFuture = await presence.getProfilePresence({
    profileId: 'friend', viewerIGT: 1_500, isActiveProfile: false,
  });
  assert.equal(beforeFuture.intervalId, 'friend-dojo');
  assert.notEqual(beforeFuture.location, SEMANTIC_LOCATION.commons);

  const switchedScene = await scenes.getSceneSnapshot({
    viewerId: 'friend', viewerIGT: 2_500, nowMs: fixed.getTime(),
  });
  const switchedPresence = switchedScene.memberById.get('friend').presence;
  assert.equal(switchedScene.viewer.profileId, 'friend');
  assert.equal(switchedPresence.intervalId, 'friend-future');
  assert.equal(switchedPresence.state, PRESENCE_STATE.current);
  assert.equal(switchedPresence.location, SEMANTIC_LOCATION.commons);
});

