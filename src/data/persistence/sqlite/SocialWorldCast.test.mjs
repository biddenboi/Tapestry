import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_CAST_ALGORITHM_VERSION,
  DYNAMIC_CAST_RESIDENCE_IGT_MS,
} from '../../../domain/social-world/DynamicCastSelection.js';
import SocialWorldCastService from '../services/SocialWorldCastService.js';
import SqliteShadowReadinessCoordinator from '../services/SqliteShadowReadinessCoordinator.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const now = new Date('2026-07-14T12:00:00.000Z');

function player(UUID, elo) {
  return { UUID, username: UUID.toUpperCase(), elo, inGameTime: 1_000, createdAt: now.toISOString() };
}

function tasksFor(parent, count, { source = 'manual', offset = 0 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    UUID: `${parent}-task-${offset + index}`,
    parent,
    name: `${parent} completed ${offset + index}`,
    completedAt: now.toISOString(),
    completedInGameTimestamp: 100 + offset + index,
    source: Array.isArray(source) ? source[index % source.length] : source,
  }));
}

async function setupCast() {
  const context = await createShadowTestContext({ now: () => now });
  await context.shadow.importers.coreProfiles.import({
    players: [player('p1', 500), player('p2', 505), player('p3', 510), player('p4', 550)],
    appState: { activePlayerUUID: 'p1' },
  });
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'p4-goal', parent: 'p4', name: 'Conditioning', status: 'active' }],
    tasks: [
      ...tasksFor('p2', 3),
      ...tasksFor('p3', 3),
      ...tasksFor('p4', 4, { source: ['dojo', 'manual'] }),
    ],
  });
  const service = new SocialWorldCastService({
    repository: context.shadow.socialWorld,
    client: context.client,
    readiness: context.readiness,
    now: () => now,
  });
  return { context, service };
}

test('dynamic cast persists across reload-like reads and accepted friends are evicted before replacement', async (t) => {
  const { context, service } = await setupCast();
  t.after(context.close);
  const first = await service.getDynamicCast({ viewerId: 'p1', viewerIGT: 1_000 });
  assert.deepEqual(first.assignments.map(({ role, subjectId }) => [role, subjectId]), [
    ['near-peer', 'p2'],
    ['horizon', 'p4'],
  ]);
  assert.equal(first.review.reviewAfterIGT, 1_000 + DYNAMIC_CAST_RESIDENCE_IGT_MS);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM social_cast_reviews', result: 'value' }), 1);

  const sourceVersion = await context.client.query({
    sql: "SELECT version FROM source_versions WHERE source_key='socialWorld'", result: 'value',
  });
  const secondService = new SocialWorldCastService({
    repository: context.shadow.socialWorld,
    client: context.client,
    readiness: context.readiness,
    now: () => now,
  });
  const second = await secondService.getDynamicCast({ viewerId: 'p1', viewerIGT: 1_001 });
  assert.equal(second.unchanged, true);
  assert.deepEqual(second.assignments.map(({ subjectId }) => subjectId), ['p2', 'p4']);
  assert.equal(await context.client.query({
    sql: "SELECT version FROM source_versions WHERE source_key='socialWorld'", result: 'value',
  }), sourceVersion);

  await context.shadow.social.requestFriendship({
    friendshipId: 'friend-p1-p2', requesterId: 'p1', recipientId: 'p2',
    notificationId: 'friend-request-p2', operationId: 'friend-request',
    createdAt: now, inGameTimestamp: 1_001,
  });
  await context.shadow.social.acceptFriendship({
    friendshipId: 'friend-p1-p2', accepterId: 'p2',
    notificationId: 'friend-accepted-p1', operationId: 'friend-accept',
    acceptedAt: new Date(now.getTime() + 1_000), inGameTimestamp: 1_002,
  });
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM social_cast_assignments WHERE viewer_player_id='p1' AND subject_player_id='p2'",
    result: 'value',
  }), 0);

  const afterFriend = await service.getDynamicCast({ viewerId: 'p1', viewerIGT: 1_002 });
  assert.equal(afterFriend.assignments.some(({ subjectId }) => subjectId === 'p2'), false);
  assert.equal(afterFriend.assignments.find(({ role }) => role === 'near-peer').subjectId, 'p3');
  assert.equal(afterFriend.review.outcome, 'role-invalidation');
});

test('an empty sparse-pool review is persisted and a new candidate waits for the deliberate boundary', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [player('viewer', 500), player('candidate', 505)],
    appState: { activePlayerUUID: 'viewer' },
  });
  const service = new SocialWorldCastService({
    repository: context.shadow.socialWorld,
    client: context.client,
    readiness: context.readiness,
    now: () => now,
  });
  const first = await service.getDynamicCast({ viewerId: 'viewer', viewerIGT: 1_000 });
  assert.deepEqual(first.assignments, []);
  assert.deepEqual(first.review.diagnostics.vacantRoles, ['near-peer', 'horizon']);
  assert.equal(first.review.diagnostics.sourceReadiness, 'complete');

  await context.shadow.importers.planning.import({ tasks: tasksFor('candidate', 3) });
  const beforeReview = await service.getDynamicCast({ viewerId: 'viewer', viewerIGT: 2_000 });
  assert.equal(beforeReview.unchanged, true);
  assert.deepEqual(beforeReview.assignments, []);

  const atReview = await service.getDynamicCast({
    viewerId: 'viewer',
    viewerIGT: first.review.reviewAfterIGT,
  });
  assert.equal(atReview.assignments.find(({ role }) => role === 'near-peer').subjectId, 'candidate');
  assert.equal(atReview.assignments.some(({ role }) => role === 'horizon'), false);
  assert.equal(atReview.review.outcome, 'scheduled');
});

test('legacy tasks without an optional source still provide factual task action evidence', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [player('viewer', 70), player('near', 88), player('horizon', 130)],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({
    tasks: [
      ...tasksFor('near', 1, { source: null }),
      ...tasksFor('horizon', 1, { source: null }),
    ],
  });
  const completedMatch = (owner, index) => ({
    UUID: `${owner}-match-${index}`,
    parent: owner,
    status: 'complete',
    createdAt: now.toISOString(),
    inGameTimestamp: 200 + index,
    completedInGameTimestamp: 300 + index,
    result: { concludedAt: now.toISOString() },
  });
  await context.shadow.importers.matches.import({
    matches: [
      completedMatch('near', 0),
      completedMatch('near', 1),
      completedMatch('horizon', 0),
      completedMatch('horizon', 1),
      completedMatch('horizon', 2),
    ],
  });
  const service = new SocialWorldCastService({
    repository: context.shadow.socialWorld,
    client: context.client,
    readiness: context.readiness,
    now: () => now,
  });

  const cast = await service.getDynamicCast({ viewerId: 'viewer', viewerIGT: 1_000 });

  assert.deepEqual(cast.assignments.map(({ role, subjectId }) => [role, subjectId]), [
    ['near-peer', 'near'],
    ['horizon', 'horizon'],
  ]);
  assert.deepEqual(
    cast.assignments.find(({ role }) => role === 'horizon').evidence.history,
    {
      completedTaskCount: 1,
      completedMatchCount: 3,
      explicitGoalCount: 0,
      actionKindCount: 2,
      interpretable: true,
    },
  );
});

test('an incomplete source cannot read or replace cast state', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  const readiness = new SqliteShadowReadinessCoordinator({ sessionId: 'incomplete' });
  let stateReads = 0;
  let replacements = 0;
  const repository = {
    getCastState: async () => {
      stateReads += 1;
      return { assignments: [], review: null };
    },
    replaceCastState: async () => {
      replacements += 1;
      return { assignments: [], review: null };
    },
  };
  const service = new SocialWorldCastService({
    repository,
    client: context.client,
    readiness,
    now: () => now,
  });
  await assert.rejects(
    service.getDynamicCast({ viewerId: 'viewer', viewerIGT: 1_000 }),
    (error) => error.code === 'social-cast-source-not-ready',
  );
  assert.equal(stateReads, 0);
  assert.equal(replacements, 0);
  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM social_cast_reviews',
    result: 'value',
  }), 0);
});

test('the immediately previous empty-review version is rebuilt after source-evidence correction', async (t) => {
  const { context, service } = await setupCast();
  t.after(context.close);
  await context.client.executeAtomic({
    commandId: 'seed-previous-version-review',
    label: 'seed-previous-version-review',
    statements: [{
      sql: `INSERT INTO social_cast_reviews(
              viewer_player_id,algorithm_version,reviewed_at_igt,review_after_igt,
              outcome,diagnostics_json,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?)`,
      bind: [
        'p1',
        DYNAMIC_CAST_ALGORITHM_VERSION - 1,
        500,
        500 + DYNAMIC_CAST_RESIDENCE_IGT_MS,
        'initial',
        JSON.stringify({ vacantRoles: ['near-peer', 'horizon'] }),
        now.toISOString(),
        now.toISOString(),
      ],
      result: 'changes',
    }],
  });

  const rebuilt = await service.getDynamicCast({ viewerId: 'p1', viewerIGT: 1_000 });
  assert.equal(rebuilt.review.algorithmVersion, DYNAMIC_CAST_ALGORITHM_VERSION);
  assert.equal(rebuilt.review.outcome, 'algorithm-upgrade');
  assert.equal(rebuilt.review.diagnostics.sourceReadiness, 'complete');
  assert.deepEqual(rebuilt.assignments.map(({ role }) => role), ['near-peer', 'horizon']);
});

test('repository rejects attempts to persist a friend directly into a dynamic role', async (t) => {
  const { context } = await setupCast();
  t.after(context.close);
  await context.shadow.importers.social.import({ friendships: [{
    UUID: 'already-friends', players: ['p1', 'p2'], requestedBy: 'p1', status: 'accepted',
    createdAt: now.toISOString(), acceptedAt: now.toISOString(),
  }] });
  await assert.rejects(context.shadow.socialWorld.replaceCastState({
    viewerId: 'p1',
    assignments: [{
      role: 'near-peer', subjectId: 'p2', algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION,
      assignedAtIGT: 1_000, reviewAfterIGT: 2_000, evidence: {},
    }],
    review: {
      algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION,
      reviewedAtIGT: 1_000,
      reviewAfterIGT: 2_000,
      outcome: 'initial', diagnostics: { sourceReadiness: 'complete' },
    },
    commandId: 'invalid-friend-cast',
  }), /social-cast-subject-is-friend/);
});
