import assert from 'node:assert/strict';
import test from 'node:test';
import SocialWorldCastService from '../services/SocialWorldCastService.js';
import SocialWorldResidencyService from '../services/SocialWorldResidencyService.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-14T18:00:00.000Z');

function player(UUID, elo = 500) {
  return { UUID, username: UUID.toUpperCase(), elo, inGameTime: 10_000, createdAt: fixed.toISOString() };
}

function tasksFor(parent, count) {
  return Array.from({ length: count }, (_, index) => ({
    UUID: `${parent}-task-${index}`,
    parent,
    name: `${parent} task ${index}`,
    completedAt: fixed.toISOString(),
    completedInGameTimestamp: 100 + index,
    source: index % 2 ? 'dojo' : 'manual',
  }));
}

async function requestAndAccept(context, requesterId, recipientId, suffix) {
  await context.shadow.social.requestFriendship({
    friendshipId: `friend-${suffix}`,
    requesterId,
    recipientId,
    notificationId: `request-notification-${suffix}`,
    operationId: `request-${suffix}`,
    createdAt: fixed,
    inGameTimestamp: 500,
  });
  return context.shadow.social.acceptFriendship({
    friendshipId: `friend-${suffix}`,
    accepterId: recipientId,
    notificationId: `accept-notification-${suffix}`,
    operationId: `accept-${suffix}`,
    acceptedAt: new Date(fixed.getTime() + Number(suffix.replace(/\D/g, '') || 0) * 1000),
    inGameTimestamp: 501,
  });
}

test('the third friend fills the final place and a fourth acceptance cannot evict anyone', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: ['viewer', 'p1', 'p2', 'p3', 'p4'].map((id) => player(id)),
    appState: { activePlayerUUID: 'viewer' },
  });
  await requestAndAccept(context, 'p1', 'viewer', '1');
  await requestAndAccept(context, 'p2', 'viewer', '2');
  await requestAndAccept(context, 'p3', 'viewer', '3');
  assert.equal((await context.shadow.social.listFriendshipsForPlayer('viewer', { status: 'accepted' })).length, 3);

  await context.shadow.social.requestFriendship({
    friendshipId: 'friend-4', requesterId: 'p4', recipientId: 'viewer',
    notificationId: 'request-notification-4', operationId: 'request-4', createdAt: fixed,
  });
  await assert.rejects(context.shadow.social.acceptFriendship({
    friendshipId: 'friend-4', accepterId: 'viewer', notificationId: 'accept-notification-4',
    operationId: 'accept-4', acceptedAt: fixed,
  }), (error) => error.code === 'friend-cap-reached');
  assert.equal((await context.shadow.social.getFriendship('friend-4')).status, 'pending');
  assert.equal((await context.shadow.social.listFriendshipsForPlayer('viewer', { status: 'accepted' })).length, 3);

  await context.shadow.social.closeFriendship({
    friendshipId: 'friend-1', actorId: 'viewer', operationId: 'open-place', closedAt: fixed,
  });
  await context.shadow.social.acceptFriendship({
    friendshipId: 'friend-4', accepterId: 'viewer', notificationId: 'accept-notification-4b',
    operationId: 'accept-4b', acceptedAt: fixed,
  });
  assert.equal((await context.shadow.social.listFriendshipsForPlayer('viewer', { status: 'accepted' })).length, 3);
});

test('a dynamic profile becoming a friend gains residency, refills its role, and preserves encounter history', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [player('viewer', 500), player('near', 505), player('replacement', 510), player('horizon', 600), player('outside', 900)],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'horizon-goal', parent: 'horizon', name: 'Long range', status: 'active' }],
    tasks: [...tasksFor('near', 3), ...tasksFor('replacement', 3), ...tasksFor('horizon', 4)],
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
  const before = await castService.getDynamicCast({ viewerId: 'viewer', viewerIGT: 1_000 });
  assert.equal(before.assignments.find((entry) => entry.role === 'near-peer').subjectId, 'near');
  const observedTasksBefore = await context.client.query({
    sql: "SELECT COUNT(*) FROM tasks WHERE player_id='near' AND completed_at IS NOT NULL", result: 'value',
  });

  await requestAndAccept(context, 'viewer', 'near', 'near');
  const residency = await residencyService.getResidency({ viewerId: 'viewer', viewerIGT: 1_001 });
  assert.deepEqual(residency.friendIds, ['near']);
  assert.equal(residency.emptyFriendSlots, 2);
  assert.equal(residency.dynamic.some((entry) => entry.subjectId === 'near'), false);
  assert.equal(residency.dynamic.find((entry) => entry.role === 'near-peer').subjectId, 'replacement');
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM tasks WHERE player_id='near' AND completed_at IS NOT NULL", result: 'value',
  }), observedTasksBefore);

  assert.equal((await residencyService.getProfileAccess({ viewerId: 'viewer', profileId: 'near', viewerIGT: 1_001 })).tier, 'friend');
  assert.equal((await residencyService.getProfileAccess({ viewerId: 'viewer', profileId: 'replacement', viewerIGT: 1_001 })).tier, 'dynamic');
  assert.equal((await residencyService.getProfileAccess({ viewerId: 'viewer', profileId: 'outside', viewerIGT: 1_001 })).tier, 'outside');
  const self = await residencyService.getProfileAccess({ viewerId: 'viewer', profileId: 'viewer', viewerIGT: 1_001 });
  assert.equal(self.tier, 'self');
  assert.equal(self.allowedTabs.includes('identity'), true);
});

test('inactive friends remain in residency and empty places do not auto-fill', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [player('viewer'), player('friend'), player('stranger')],
    appState: { activePlayerUUID: 'viewer' },
  });
  await requestAndAccept(context, 'viewer', 'friend', 'inactive');
  await context.client.executeAtomic({
    commandId: 'archive-friend', label: 'archive-friend', statements: [{
      sql: "UPDATE players SET archived_at=? WHERE id='friend'", bind: [fixed.toISOString()], result: 'changes',
    }],
  });
  const service = new SocialWorldResidencyService({ socialRepository: context.shadow.social, client: context.client });
  const residency = await service.getResidency({ viewerId: 'viewer', viewerIGT: 2_000 });
  assert.deepEqual(residency.friendIds, ['friend']);
  assert.equal(residency.friends[0].profile.archivedAt, fixed.toISOString());
  assert.equal(residency.emptyFriendSlots, 2);
  assert.equal(residency.friendIds.includes('stranger'), false);
});

test('residency preserves the last valid cast while a projection is dirty', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [player('viewer', 500), player('near', 505)],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({ tasks: tasksFor('near', 3) });
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
  const ready = await residencyService.getResidency({ viewerId: 'viewer', viewerIGT: 1_000 });
  assert.equal(ready.dynamic[0].subjectId, 'near');
  context.readiness.markDirty('planning');

  const temporarilyUnavailable = await residencyService.getResidency({
    viewerId: 'viewer',
    viewerIGT: 1_001,
  });
  assert.equal(temporarilyUnavailable.dynamic[0].subjectId, 'near');
  assert.equal(temporarilyUnavailable.castSourceUnavailable.code, 'social-cast-source-not-ready');
});

test('a factual viewer-cursor recovery clears only that viewer cast state', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [player('viewer', 500), player('near', 505)],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({ tasks: tasksFor('near', 3) });
  const castService = new SocialWorldCastService({
    repository: context.shadow.socialWorld,
    client: context.client,
    readiness: context.readiness,
    now: () => fixed,
  });
  await castService.getDynamicCast({ viewerId: 'viewer', viewerIGT: 0 });
  assert.ok((await context.shadow.socialWorld.getCastState('viewer')).review);

  const cleared = await context.shadow.socialWorld.clearCastStateForCursorRecovery({
    viewerId: 'viewer',
    recoveredCursor: 51_936_543,
  });
  const state = await context.shadow.socialWorld.getCastState('viewer');

  assert.equal(cleared.duplicate, false);
  assert.deepEqual(state.assignments, []);
  assert.equal(state.review, null);
});
