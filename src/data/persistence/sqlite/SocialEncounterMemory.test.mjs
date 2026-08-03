import assert from 'node:assert/strict';
import test from 'node:test';
import SocialActivityIndexService from '../services/SocialActivityIndexService.js';
import SocialEncounterService from '../services/SocialEncounterService.js';
import { DYNAMIC_CAST_ALGORITHM_VERSION } from '../../../domain/social-world/DynamicCastSelection.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-14T20:00:00.000Z');
const viewerIGT = 1_000;

function task(id, name, occurredIGT, extra = {}) {
  return {
    UUID: id,
    parent: 'subject',
    projectId: 'project-1',
    name,
    points: 25,
    actualDurationMs: 60_000,
    completedAt: fixed.toISOString(),
    completedInGameTimestamp: occurredIGT,
    createdAt: fixed.toISOString(),
    ...extra,
  };
}

test('exact receipts distinguish new, unchanged, updated, late-imported, and future facts', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'viewer', username: 'Viewer', elo: 500, inGameTime: viewerIGT, createdAt: fixed.toISOString() },
      { UUID: 'subject', username: 'Subject', elo: 510, inGameTime: viewerIGT, createdAt: fixed.toISOString() },
    ],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'project-1', parent: 'subject', name: 'Semantic path', status: 'active', createdAt: fixed.toISOString() }],
    todos: [{
      UUID: 'todo-1', parent: 'subject', projectId: 'project-1', name: 'Committed review',
      dueDate: '2026-07-20T20:00:00.000Z', createdAt: fixed.toISOString(),
    }],
    tasks: [task('task-1', 'Initial route', 400)],
  });
  const activityIndex = new SocialActivityIndexService({ client: context.client, now: () => fixed });
  const encounters = new SocialEncounterService({ client: context.client, activityIndex, now: () => fixed });

  const initial = await encounters.getSinceLastSaw({ viewerId: 'viewer', subjectId: 'subject', viewerIGT });
  assert.equal(initial.count >= 3, true);
  assert.equal(initial.facts.some((fact) => fact.kind === 'task' && fact.id === 'task-1'), true);
  assert.equal(initial.facts.every((fact) => fact.changeState === 'new'), true);

  const firstReceipt = await encounters.recordEncounter({
    viewerId: 'viewer', subjectId: 'subject', viewerIGT, surface: 'since-last-saw',
    visibleFacts: initial.facts, operationId: 'inspect-initial', encounteredAt: fixed,
  });
  assert.equal(firstReceipt.recorded, true);
  assert.equal((await encounters.recordEncounter({
    viewerId: 'viewer', subjectId: 'subject', viewerIGT, surface: 'since-last-saw',
    visibleFacts: initial.facts, operationId: 'inspect-initial', encounteredAt: fixed,
  })).duplicate, true);
  assert.equal((await encounters.getSinceLastSaw({ viewerId: 'viewer', subjectId: 'subject', viewerIGT })).count, 0);

  await context.shadow.planning.upsertTask(task('task-1', 'Initial route', 400, {
    updatedAt: '2026-07-14T20:01:00.000Z', cacheHint: 'non-semantic',
  }), { operationId: 'non-semantic-update' });
  assert.equal((await encounters.getSinceLastSaw({ viewerId: 'viewer', subjectId: 'subject', viewerIGT })).count, 0);

  await context.shadow.planning.upsertTask(task('task-1', 'Revised route', 400, {
    updatedAt: '2026-07-14T20:02:00.000Z',
  }), { operationId: 'semantic-update' });
  const updated = await encounters.getSinceLastSaw({ viewerId: 'viewer', subjectId: 'subject', viewerIGT });
  assert.deepEqual(updated.facts.filter((fact) => fact.id === 'task-1').map((fact) => fact.changeState), ['updated']);
  await encounters.recordEncounter({
    viewerId: 'viewer', subjectId: 'subject', viewerIGT, surface: 'profile-drawer',
    visibleFacts: updated.facts, operationId: 'inspect-update', encounteredAt: fixed,
  });

  await context.shadow.planning.upsertTask(task('late-old', 'Late imported older work', 100), {
    operationId: 'late-import',
  });
  await context.shadow.planning.upsertTask(task('future', 'Future work', 2_000), {
    operationId: 'future-import',
  });
  const afterImport = await encounters.getSinceLastSaw({ viewerId: 'viewer', subjectId: 'subject', viewerIGT });
  assert.equal(afterImport.facts.some((fact) => fact.id === 'late-old' && fact.changeState === 'new'), true);
  assert.equal(afterImport.facts.some((fact) => fact.id === 'future'), false);

  await encounters.recordEncounter({
    viewerId: 'viewer', subjectId: 'subject', viewerIGT, surface: 'profile-drawer',
    visibleFacts: afterImport.facts, operationId: 'inspect-late-import', encounteredAt: fixed,
  });
  const receiptsBeforeFriendship = await context.client.query({
    sql: "SELECT COUNT(*) FROM social_event_receipts WHERE viewer_player_id='viewer' AND subject_player_id='subject'",
    result: 'value',
  });
  await context.shadow.socialWorld.replaceCastState({
    viewerId: 'viewer',
    assignments: [{
      role: 'near-peer', subjectId: 'subject', algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION,
      assignedAtIGT: viewerIGT, reviewAfterIGT: viewerIGT + 1_000, evidence: {},
    }],
    review: {
      algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION,
      reviewedAtIGT: viewerIGT,
      reviewAfterIGT: viewerIGT + 1_000,
      outcome: 'initial', diagnostics: { sourceReadiness: 'complete' },
    },
    commandId: 'cast-before-friendship', committedAt: fixed,
  });
  await context.shadow.social.requestFriendship({
    friendshipId: 'friendship', requesterId: 'viewer', recipientId: 'subject',
    notificationId: 'friendship-request', operationId: 'request-friendship',
    createdAt: fixed, inGameTimestamp: viewerIGT,
  });
  await context.shadow.social.acceptFriendship({
    friendshipId: 'friendship', accepterId: 'subject',
    notificationId: 'friendship-accepted', operationId: 'accept-friendship',
    acceptedAt: fixed, inGameTimestamp: viewerIGT,
  });
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM social_cast_assignments WHERE viewer_player_id='viewer' AND subject_player_id='subject'",
    result: 'value',
  }), 0);
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM social_event_receipts WHERE viewer_player_id='viewer' AND subject_player_id='subject'",
    result: 'value',
  }), receiptsBeforeFriendship);
  assert.equal((await encounters.getSinceLastSaw({ viewerId: 'viewer', subjectId: 'subject', viewerIGT })).count, 0);
});
