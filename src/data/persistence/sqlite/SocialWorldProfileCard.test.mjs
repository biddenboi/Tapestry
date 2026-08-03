import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, MINUTE } from '../../../domain/constants.js';
import { CAST_ROLE, SEMANTIC_LOCATION } from '../../../domain/social-world/SocialWorldContracts.js';
import SocialWorldProfileCardQueryService from '../services/SocialWorldProfileCardQueryService.js';
import SocialWorldQueryService from '../services/SocialWorldQueryService.js';
import SocialWorldResidencyService from '../services/SocialWorldResidencyService.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-14T18:00:00.000Z');
const viewerIGT = (3 * DAY) + (2 * 60 * MINUTE);

function completedTask(id, completedIGT, points, duration) {
  return {
    UUID: id,
    parent: 'viewer',
    projectId: 'project-1',
    name: `Evidence ${id}`,
    points,
    pointsBase: points,
    actualDurationMs: duration,
    completedAt: fixed.toISOString(),
    completedInGameTimestamp: completedIGT,
    createdAt: fixed.toISOString(),
  };
}

test('prepared profile card returns factual Now, Today, Thread, Next, and bounded New', async (t) => {
  const context = await createShadowTestContext({ now: () => fixed });
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [
      {
        UUID: 'viewer', username: 'Viewer', elo: 700, inGameTime: viewerIGT,
        activeCosmetics: { title: 'builder' }, createdAt: fixed.toISOString(),
      },
      { UUID: 'outside', username: 'Outside', elo: 900, createdAt: fixed.toISOString() },
    ],
    appState: { activePlayerUUID: 'viewer' },
  });
  await context.shadow.importers.planning.import({
    projects: [{
      UUID: 'project-1', parent: 'viewer', name: 'Semantic world audit', status: 'active',
      createdAt: fixed.toISOString(),
    }],
    todos: [
      {
        UUID: 'todo-due', parent: 'viewer', projectId: 'project-1', name: 'Review the inactive rail',
        dueDate: '2026-07-15T18:00:00.000Z', createdAt: fixed.toISOString(),
      },
      {
        UUID: 'todo-open', parent: 'viewer', projectId: 'project-1', name: 'Undated possibility',
        dueDate: null, createdAt: fixed.toISOString(),
      },
      {
        UUID: 'todo-created-later', parent: 'viewer', projectId: 'project-1', name: 'Future knowledge',
        dueDate: '2026-07-16T18:00:00.000Z', inGameTimestamp: viewerIGT + MINUTE,
        createdAt: fixed.toISOString(),
      },
    ],
    tasks: [
      completedTask('task-today-1', (3 * DAY) + (20 * MINUTE), 120, 15 * MINUTE),
      completedTask('task-today-2', (3 * DAY) + (40 * MINUTE), 180, 20 * MINUTE),
      completedTask('task-prior', (2 * DAY) + (40 * MINUTE), 90, 10 * MINUTE),
      completedTask('task-future', (4 * DAY) + (10 * MINUTE), 999, 99 * MINUTE),
    ],
  });
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'viewer-session',
    playerId: 'viewer',
    location: SEMANTIC_LOCATION.taskSession,
    startedIGT: (3 * DAY) + (60 * MINUTE),
    enteredAt: fixed,
    sourceType: 'task',
    sourceId: 'todo-due',
    commandId: 'viewer-session-enter',
  });

  const residencyService = new SocialWorldResidencyService({
    socialRepository: context.shadow.social,
    client: context.client,
  });
  const presenceQueryService = new SocialWorldQueryService({
    repository: context.shadow.socialWorld,
    client: context.client,
    now: () => fixed,
  });
  const service = new SocialWorldProfileCardQueryService({
    residencyService,
    presenceQueryService,
    client: context.client,
  });

  const card = await service.getProfileCard({
    viewerId: 'viewer', profileId: 'viewer', viewerIGT, nowMs: fixed.getTime(),
  });
  assert.equal(card.role, CAST_ROLE.self);
  assert.equal(card.identity.title, 'builder');
  assert.equal(card.now.activityLabel, 'Task in progress');
  assert.deepEqual(card.today, {
    dayIndex: 3,
    tasks: 2,
    points: 300,
    activeMs: 35 * MINUTE,
  });
  assert.equal(card.thread.label, 'Semantic world audit');
  assert.equal(card.thread.evidenceCount, 3);
  assert.deepEqual(card.past.map((entry) => entry.id), ['task-today-2', 'task-today-1', 'task-prior']);
  assert.deepEqual(card.past.map((entry) => entry.basePoints), [180, 120, 90]);
  assert.deepEqual(card.next.map((entry) => entry.id), ['todo-due']);
  assert.deepEqual(card.new, { count: 0, preview: [], facts: [], groups: [], previousEncounter: null });
  assert.equal(await service.getProfileCard({
    viewerId: 'viewer', profileId: 'outside', viewerIGT, nowMs: fixed.getTime(),
  }), null);

  const warmDurations = [];
  for (let index = 0; index < 9; index += 1) {
    const startedAt = performance.now();
    await service.getProfileCard({
      viewerId: 'viewer', profileId: 'viewer', viewerIGT, nowMs: fixed.getTime(),
    });
    warmDurations.push(performance.now() - startedAt);
  }
  warmDurations.sort((left, right) => left - right);
  const p50 = warmDurations[Math.floor(warmDurations.length * 0.5)];
  const p95 = warmDurations[Math.floor(warmDurations.length * 0.95)];
  assert.equal(p95 < 100, true, `warm profile-card query p95 ${p95.toFixed(2)}ms exceeds 100ms`);
  t.diagnostic(`warm profile-card query p50 ${p50.toFixed(2)}ms · p95 ${p95.toFixed(2)}ms`);
});
