import assert from 'node:assert/strict';
import test from 'node:test';
import { DATA_DOMAIN, DOMAIN_INVALIDATION } from '../../../app/context/domainRevisions.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-13T00:00:00.000Z');

async function setup() {
  const context = await createShadowTestContext({ now: () => fixed });
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'p1', username: 'Alpha', elo: 1100, createdAt: fixed.toISOString() },
      { UUID: 'p2', username: 'Beta', elo: 1000, createdAt: fixed.toISOString() },
      { UUID: 'p3', username: 'Gamma', elo: 900, createdAt: fixed.toISOString() },
    ],
    appState: { activePlayerUUID: 'p1' },
  });
  return context;
}

test('Batch 21 imports two-party friendships and temporally visible notifications with parity', async (t) => {
  const context = await setup();
  t.after(context.close);
  const fixture = {
    friendships: [
      { UUID: 'friend-accepted', players: ['p1','p2'], requestedBy: 'p1', status: 'accepted', createdAt: '2026-07-10T00:00:00.000Z', acceptedAt: '2026-07-10T01:00:00.000Z', inGameTimestamp: 10 },
      { UUID: 'friend-pending', players: ['p3','p1'], requestedBy: 'p3', status: 'pending', createdAt: '2026-07-11T00:00:00.000Z', inGameTimestamp: 20 },
      { UUID: 'friend-invalid', players: ['p1'], requestedBy: 'p1', status: 'pending' },
    ],
    notifications: [
      { UUID: 'n1', parent: 'p1', title: 'Request', message: 'Gamma asks', kind: 'friend_request', createdAt: '2026-07-11T00:00:00.000Z', inGameTimestamp: 20, readAt: null, meta: { friendshipUUID: 'friend-pending', requesterUUID: 'p3' } },
      { UUID: 'n2', parent: 'p1', title: 'Future', message: 'Later', kind: 'info', createdAt: '2026-07-12T00:00:00.000Z', inGameTimestamp: 200, readAt: null, meta: {} },
    ],
  };
  const imported = await context.shadow.importers.social.import(fixture);
  assert.deepEqual(imported.counts, { friendships: 2, notifications: 2, diagnostics: 1 });
  assert.equal(imported.diagnostics[0].reason, 'invalid-membership');

  const relationships = await context.shadow.social.listFriendshipsForPlayer('p1');
  assert.deepEqual(relationships.map((row) => [row.UUID,row.status,row.players]), [
    ['friend-accepted','accepted',['p1','p2']],
    ['friend-pending','pending',['p3','p1']],
  ]);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM friendship_members', result: 'value' }), 4);
  const visible = await context.shadow.social.listNotificationsForPlayer('p1', { viewerIGT: 50 });
  assert.deepEqual(visible.map((row) => row.UUID), ['n1']);
  assert.equal(await context.shadow.social.getUnreadFriendRequestCount('p1', { viewerIGT: 50 }), 1);
  assert.equal((await context.shadow.importers.social.import(fixture)).duplicate, true);

  const changedSnapshot = await context.shadow.importers.social.import({
    ...fixture,
    friendships: [
      ...fixture.friendships,
      {
        UUID: 'friend-new',
        players: ['p2','p3'],
        requestedBy: 'p2',
        status: 'pending',
        createdAt: '2026-07-12T12:00:00.000Z',
        inGameTimestamp: 30,
      },
    ],
  });
  assert.equal(changedSnapshot.duplicate, false);
  assert.equal(changedSnapshot.counts.friendships, 3);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM friendship_members', result: 'value' }), 6);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 21 database constraints reject invalid relationship shapes and preserve generated membership rows', async (t) => {
  const context = await setup();
  t.after(context.close);
  await assert.rejects(context.client.executeAtomic({
    commandId: 'invalid-self-friendship', label: 'invalid-self-friendship', statements: [{
      sql: `INSERT INTO friendships(id,requester_player_id,recipient_player_id,status,created_at,accepted_at,metadata_json)
            VALUES('bad','p1','p1','pending',?,NULL,'{}')`, bind: [fixed.toISOString()], result: 'changes',
    }],
  }));

  await context.shadow.social.requestFriendship({
    friendshipId: 'f1', requesterId: 'p1', recipientId: 'p2', notificationId: 'request-n1',
    operationId: 'request-op-1', createdAt: fixed, inGameTimestamp: 5,
  });
  await assert.rejects(context.client.executeAtomic({
    commandId: 'invalid-third-member', label: 'invalid-third-member', statements: [{
      sql: `INSERT INTO friendship_members(friendship_id,player_id,member_role,joined_at)
            VALUES('f1','p3','recipient',?)`, bind: [fixed.toISOString()], result: 'changes',
    }],
  }));
  await context.client.executeAtomic({
    commandId: 'delete-generated-member', label: 'delete-generated-member', statements: [{
      sql: "DELETE FROM friendship_members WHERE friendship_id='f1' AND player_id='p2'", result: 'changes',
    }],
  });
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM friendship_members WHERE friendship_id='f1'", result: 'value' }), 2);
  await assert.rejects(context.shadow.social.requestFriendship({
    friendshipId: 'f2', requesterId: 'p2', recipientId: 'p1', notificationId: 'request-n2',
    operationId: 'request-op-2', createdAt: fixed,
  }), (error) => error.code === 'friendship-exists');
});

test('Batch 21 request, acceptance, inbox reads, and closure are idempotent and invalidate only intended views', async (t) => {
  const context = await setup();
  t.after(context.close);
  const before = await context.shadow.social.getSourceVersions();
  const request = await context.shadow.social.requestFriendship({
    friendshipId: 'f1', requesterId: 'p1', recipientId: 'p2', notificationId: 'n-request',
    operationId: 'request-1', createdAt: fixed, inGameTimestamp: 30,
    title: 'Alpha sent a request', message: 'Open Alpha’s profile.',
  });
  assert.equal(request.friendship.status, 'pending');
  assert.deepEqual(request.invalidatedDomains, ['social','socialWorld','achievements','profileSummaries']);
  const afterRequest = await context.shadow.social.getSourceVersions();
  for (const key of ['social','achievements','profileSummaries']) assert.equal(afterRequest[key], before[key] + 1);
  assert.equal(afterRequest.socialWorld, before.socialWorld + 1);
  for (const key of ['profiles','tasks','matches','leaderboards']) assert.equal(afterRequest[key], before[key]);

  const replay = await context.shadow.social.requestFriendship({
    friendshipId: 'ignored', requesterId: 'p1', recipientId: 'p2', notificationId: 'ignored',
    operationId: 'request-1', createdAt: fixed,
  });
  assert.equal(replay.duplicate, true);
  assert.equal((await context.shadow.social.getSourceVersions()).social, afterRequest.social);
  await assert.rejects(context.shadow.social.acceptFriendship({
    friendshipId: 'f1', accepterId: 'p1', notificationId: 'bad-accept', operationId: 'accept-bad', acceptedAt: fixed,
  }), (error) => error.code === 'not-acceptable');

  const accepted = await context.shadow.social.acceptFriendship({
    friendshipId: 'f1', accepterId: 'p2', notificationId: 'n-accepted', operationId: 'accept-1',
    acceptedAt: new Date(fixed.getTime() + 1000), inGameTimestamp: 40,
    title: 'Accepted', message: 'Beta accepted your request.',
  });
  assert.equal(accepted.friendship.status, 'accepted');
  const p2Notifications = await context.shadow.social.listNotificationsForPlayer('p2');
  assert.equal(p2Notifications[0].readAt, new Date(fixed.getTime() + 1000).toISOString());
  const p1Notifications = await context.shadow.social.listNotificationsForPlayer('p1');
  assert.deepEqual(p1Notifications.map((row) => [row.UUID,row.kind]), [['n-accepted','friend_accepted']]);

  const beforeRead = await context.shadow.social.getSourceVersions();
  await context.shadow.social.markNotificationRead('n-accepted', { operationId: 'read-1', readAt: new Date(fixed.getTime() + 2000) });
  const afterRead = await context.shadow.social.getSourceVersions();
  assert.equal(afterRead.social, beforeRead.social + 1);
  assert.equal(afterRead.achievements, beforeRead.achievements);
  assert.equal(afterRead.profileSummaries, beforeRead.profileSummaries);

  await context.shadow.social.closeFriendship({ friendshipId: 'f1', actorId: 'p1', operationId: 'close-1', closedAt: new Date(fixed.getTime() + 3000) });
  assert.equal(await context.shadow.social.getFriendship('f1'), null);
  assert.equal((await context.shadow.social.listFriendshipsForPlayer('p2')).length, 0);
  assert.deepEqual(DOMAIN_INVALIDATION.inboxWrite, [DATA_DOMAIN.social]);
  assert.deepEqual(DOMAIN_INVALIDATION.socialWrite, [DATA_DOMAIN.social,DATA_DOMAIN.socialWorld,DATA_DOMAIN.achievements,DATA_DOMAIN.profileSummaries,DATA_DOMAIN.contributionRoad]);
});

test('Batch 21 profile wipe removes ephemeral social state without dangling memberships', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.social.requestFriendship({
    friendshipId: 'wipe-friend', requesterId: 'p1', recipientId: 'p2', notificationId: 'wipe-notification',
    operationId: 'wipe-request', createdAt: fixed,
  });
  const wiped = await context.shadow.coreProfiles.wipeProfile('p2', { operationId: 'wipe-social-p2', now: fixed });
  assert.equal(wiped.counts.friendshipsDeleted, 1);
  assert.equal(wiped.counts.notificationsDeleted, 1);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM friendships WHERE id='wipe-friend'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM friendship_members WHERE friendship_id='wipe-friend'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM notifications WHERE id='wipe-notification'", result: 'value' }), 0);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});
