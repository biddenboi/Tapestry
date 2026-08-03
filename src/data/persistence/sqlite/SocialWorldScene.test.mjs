import assert from 'node:assert/strict';
import test from 'node:test';
import { CAST_ROLE, PRESENCE_STATE, SEMANTIC_LOCATION } from '../../../domain/social-world/SocialWorldContracts.js';
import SocialWorldCastService from '../services/SocialWorldCastService.js';
import SocialWorldQueryService from '../services/SocialWorldQueryService.js';
import SocialWorldResidencyService from '../services/SocialWorldResidencyService.js';
import SocialWorldSceneQueryService from '../services/SocialWorldSceneQueryService.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-14T18:00:00.000Z');

function tasksFor(parent, count) {
  return Array.from({ length: count }, (_, index) => ({
    UUID: `${parent}-task-${index}`,
    parent,
    name: `${parent} task ${index}`,
    completedAt: fixed.toISOString(),
    completedInGameTimestamp: 100 + index,
    source: index % 2 ? 'manual' : 'dojo',
  }));
}

test('one prepared query returns Self, Near-peer, and Horizon at the viewer IGT', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'viewer', username: 'Viewer', elo: 500, inGameTime: 1_000, createdAt: fixed.toISOString() },
      { UUID: 'near', username: 'Near', elo: 505, inGameTime: 1_000, createdAt: fixed.toISOString() },
      { UUID: 'horizon', username: 'Horizon', elo: 620, inGameTime: 1_000, createdAt: fixed.toISOString() },
    ],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'horizon-goal', parent: 'horizon', name: 'Long range', status: 'active' }],
    tasks: [...tasksFor('near', 3), ...tasksFor('horizon', 5)],
  });
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'viewer-commons', playerId: 'viewer', location: SEMANTIC_LOCATION.commons,
    startedIGT: 500, enteredAt: fixed, sourceType: 'surface', sourceId: 'map', commandId: 'viewer-enter',
  });
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'near-task', playerId: 'near', location: SEMANTIC_LOCATION.taskSession,
    startedIGT: 600, enteredAt: fixed, sourceType: 'task', sourceId: 'near-work', commandId: 'near-enter',
  });
  await context.shadow.socialWorld.closePresence({
    playerId: 'near', endedIGT: 1_200, exitedAt: new Date(fixed.getTime() + 600),
    closeReason: 'completed', commandId: 'near-close',
  });
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'horizon-dojo', playerId: 'horizon', location: SEMANTIC_LOCATION.dojo,
    startedIGT: 800, enteredAt: fixed, sourceType: 'dojo-session', sourceId: 'horizon-train', commandId: 'horizon-enter',
  });
  await context.shadow.socialWorld.closePresence({
    playerId: 'horizon', endedIGT: 1_300, exitedAt: new Date(fixed.getTime() + 500),
    closeReason: 'completed', commandId: 'horizon-close',
  });

  const castService = new SocialWorldCastService({
    repository: context.shadow.socialWorld,
    client: context.client,
    readiness: context.readiness,
    now: () => fixed,
  });
  const residencyService = new SocialWorldResidencyService({
    socialRepository: context.shadow.social,
    castService,
    client: context.client,
  });
  const presenceQueryService = new SocialWorldQueryService({
    repository: context.shadow.socialWorld,
    client: context.client,
    now: () => fixed,
  });
  const getProfilesPresence = presenceQueryService.getProfilesPresence.bind(presenceQueryService);
  const presenceBatches = [];
  presenceQueryService.getProfilesPresence = async (query) => {
    presenceBatches.push(query);
    return getProfilesPresence(query);
  };
  const service = new SocialWorldSceneQueryService({
    residencyService,
    presenceQueryService,
    client: context.client,
  });
  const scene = await service.getSceneSnapshot({ viewerId: 'viewer', viewerIGT: 1_000, nowMs: fixed.getTime() });

  assert.equal(scene.members.length, 3);
  assert.equal(scene.memberById.get('viewer').presence.state, PRESENCE_STATE.current);
  assert.deepEqual(
    scene.members.filter((member) => member.role !== CAST_ROLE.self).map((member) => member.role).sort(),
    [CAST_ROLE.horizon, CAST_ROLE.nearPeer].sort(),
  );
  assert.equal(scene.memberById.get('near').presence.location, SEMANTIC_LOCATION.taskSession);
  assert.equal(scene.memberById.get('horizon').presence.location, SEMANTIC_LOCATION.dojo);
  assert.equal(presenceBatches.length, 1);
  assert.equal(presenceBatches[0].viewerIGT, 1_000);
  assert.equal(presenceBatches[0].activeProfileId, 'viewer');
  assert.deepEqual([...presenceBatches[0].profileIds].sort(), ['horizon', 'near', 'viewer']);
  assert.equal(scene.sourceVersions.presence > 0, true);
  assert.equal(scene.sourceVersions.socialWorld > 0, true);

  const warmDurations = [];
  for (let index = 0; index < 9; index += 1) {
    const startedAt = performance.now();
    await service.getSceneSnapshot({ viewerId: 'viewer', viewerIGT: 1_000, nowMs: fixed.getTime() });
    warmDurations.push(performance.now() - startedAt);
  }
  warmDurations.sort((left, right) => left - right);
  const p50 = warmDurations[Math.floor(warmDurations.length * 0.5)];
  const p95 = warmDurations[Math.floor(warmDurations.length * 0.95)];
  assert.equal(p95 < 100, true, `warm scene query p95 ${p95.toFixed(2)}ms exceeds 100ms`);
  t.diagnostic(`warm scene query p50 ${p50.toFixed(2)}ms · p95 ${p95.toFixed(2)}ms`);
});
