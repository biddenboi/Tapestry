import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPresence } from '../../../domain/social-world/PresenceProjection.js';
import { PRESENCE_STATE, SEMANTIC_LOCATION } from '../../../domain/social-world/SocialWorldContracts.js';
import { PRESENCE_INTERRUPTION } from '../../../domain/social-world/SocialWorldContracts.js';
import {
  getCurrentIGT,
  migratePlayerIGTClock,
} from '../../../domain/time/Time.js';
import SocialWorldPresenceService from '../services/SocialWorldPresenceService.js';
import SocialWorldQueryService from '../services/SocialWorldQueryService.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const origin = new Date('2026-07-14T12:00:00.000Z');

async function setup({ now = () => origin } = {}) {
  const context = await createShadowTestContext({ now });
  await context.shadow.importers.coreProfiles.import({
    players: [
      {
        UUID: 'p1', username: 'Alpha', inGameTime: 1000,
        createdAt: '2026-07-01T05:00:00.000Z',
      },
      {
        UUID: 'p2', username: 'Beta', inGameTime: 4000,
        createdAt: '2026-07-02T05:00:00.000Z',
      },
    ],
    appState: { activePlayerUUID: 'p1' },
  });
  return context;
}

test('Task Session occupancy advances through pause while focused time does not', async (t) => {
  const context = await setup();
  t.after(context.close);
  const repository = context.shadow.socialWorld;

  await repository.transitionPresence({
    intervalId: 'presence-task-1', playerId: 'p1', location: SEMANTIC_LOCATION.taskSession,
    startedIGT: 1000, enteredAt: origin, sourceType: 'task', sourceId: 'task-1', commandId: 'enter-task-1',
  });
  const pausedAt = new Date(origin.getTime() + 10 * 60_000);
  const paused = await repository.pausePresence({
    playerId: 'p1', pausedAt, pausedIGT: 601_000, commandId: 'pause-task-1',
  });
  assert.equal(paused.interval.activeElapsedMs, 600_000);
  assert.equal(paused.interval.activeAnchorAt, null);
  assert.equal((await repository.pausePresence({
    playerId: 'p1', pausedAt, pausedIGT: 601_000, commandId: 'pause-task-1',
  })).duplicate, true);

  const resumedAt = new Date(origin.getTime() + 21 * 60_000);
  await repository.resumePresence({
    playerId: 'p1', resumedAt, resumedIGT: 1_261_000, commandId: 'resume-task-1',
  });
  const exitedAt = new Date(origin.getTime() + 26 * 60_000);
  const closed = await repository.closePresence({
    playerId: 'p1', endedIGT: 1_561_000, exitedAt,
    closeReason: 'completed', commandId: 'complete-task-1',
  });
  assert.equal(closed.interval.endedIGT, 1_561_000);
  assert.equal(closed.interval.activeElapsedMs, 900_000);
  assert.equal(closed.interval.closeReason, 'completed');

  const projection = projectPresence({
    intervals: [closed.interval], viewerIGT: 1_561_000,
    isActiveProfile: true, nowMs: exitedAt.getTime(),
  });
  assert.equal(projection.state, PRESENCE_STATE.recent);
  assert.equal(projection.elapsedHere, 1_560_000);
  assert.equal(projection.activeElapsed, 900_000);
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM semantic_presence_intervals WHERE player_id='p1' AND ended_igt IS NULL",
    result: 'value',
  }), 0);
});

test('location transition closes the prior interval atomically and never leaves two open rows', async (t) => {
  const context = await setup();
  t.after(context.close);
  const repository = context.shadow.socialWorld;
  await repository.transitionPresence({
    intervalId: 'planning-1', playerId: 'p1', location: SEMANTIC_LOCATION.planning,
    startedIGT: 1000, enteredAt: origin, sourceType: 'panel', sourceId: 'tasks', commandId: 'planning-enter',
  });
  await repository.transitionPresence({
    intervalId: 'market-1', playerId: 'p1', location: SEMANTIC_LOCATION.marketplace,
    startedIGT: 61_000, enteredAt: new Date(origin.getTime() + 60_000),
    sourceType: 'panel', sourceId: 'shop', commandId: 'market-enter',
  });
  const planning = await repository.getInterval('planning-1');
  const market = await repository.getOpenInterval('p1');
  assert.equal(planning.endedIGT, 61_000);
  assert.equal(planning.closeReason, 'interrupted');
  assert.equal(market.location, SEMANTIC_LOCATION.marketplace);
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM semantic_presence_intervals WHERE player_id='p1' AND ended_igt IS NULL",
    result: 'value',
  }), 1);
});

test('startup reconciliation closes impossible ordinary visits at current wall-clock IGT', async (t) => {
  const context = await setup();
  t.after(context.close);
  const repository = context.shadow.socialWorld;
  await repository.transitionPresence({
    intervalId: 'stale-planning', playerId: 'p1', location: SEMANTIC_LOCATION.planning,
    startedIGT: 1000, enteredAt: origin, sourceType: 'panel', sourceId: 'tasks', commandId: 'stale-enter',
  });
  const reconciledAt = new Date(origin.getTime() + 86_400_000);
  const result = await repository.reconcileOpenIntervals({ commandId: 'startup-1', reconciledAt });
  assert.equal(result.closed.length, 1);
  assert.equal(
    result.closed[0].endedIGT,
    getCurrentIGT(migratePlayerIGTClock({
      inGameTime: 1000,
      createdAt: '2026-07-01T05:00:00.000Z',
    }, {
      active: true,
      nowMs: reconciledAt.getTime(),
    }), reconciledAt.getTime()),
  );
  assert.equal(result.closed[0].closeReason, 'reconciled-after-close');
  assert.equal(result.closed[0].activeAnchorAt, null);
});

test('backgrounding closes ordinary visits while an explicitly recoverable Match may remain', async (t) => {
  const context = await setup();
  t.after(context.close);
  const service = new SocialWorldPresenceService({
    repository: context.shadow.socialWorld,
    now: () => origin,
    idFactory: (prefix) => `${prefix}:fixed`,
  });
  await service.transitionPresence({
    playerId: 'p1', location: SEMANTIC_LOCATION.marketplace, viewerIGT: 1000,
    sourceType: 'panel', sourceId: 'shop', commandId: 'market-background-enter',
  });
  const ordinary = await service.closePresence({
    playerId: 'p1', viewerIGT: 61_000,
    interruption: PRESENCE_INTERRUPTION.appBackground,
    commandId: 'market-background-close',
    at: new Date(origin.getTime() + 60_000),
  });
  assert.equal(ordinary.interval.closeReason, 'backgrounded');

  await service.transitionPresence({
    playerId: 'p1', location: SEMANTIC_LOCATION.matchArena, viewerIGT: 61_000,
    sourceType: 'match', sourceId: 'match-active', commandId: 'match-enter',
    intervalId: 'presence:match', at: new Date(origin.getTime() + 60_000),
  });
  const durable = await service.closePresence({
    playerId: 'p1', viewerIGT: 121_000,
    interruption: PRESENCE_INTERRUPTION.appBackground,
    domainSupportsRecovery: true,
    commandId: 'match-background',
  });
  assert.equal(durable.retainedForRecovery, true);
  assert.equal((await context.shadow.socialWorld.getOpenInterval('p1')).location, SEMANTIC_LOCATION.matchArena);
});

test('profile switch closes presence, snapshots both wall clocks, and replays once', async (t) => {
  const switchAt = new Date(origin.getTime() + 10_000);
  const context = await setup({ now: () => switchAt });
  t.after(context.close);
  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'switch-task', playerId: 'p1', location: SEMANTIC_LOCATION.taskSession,
    startedIGT: 1000, enteredAt: origin, sourceType: 'task', sourceId: 'task-1', commandId: 'switch-task-enter',
  });
  const first = await context.shadow.coreProfiles.switchProfile({
    fromPlayerId: 'p1', toPlayerId: 'p2', operationId: 'switch-presence', now: switchAt,
    commonsVisible: true, commonsIntervalId: 'p2-commons',
  });
  assert.equal(first.status, 'switched');
  assert.equal(
    (await context.shadow.coreProfiles.getPlayer('p1')).inGameTime,
    getCurrentIGT(migratePlayerIGTClock({
      inGameTime: 1000,
      createdAt: '2026-07-01T05:00:00.000Z',
    }, {
      active: true,
      nowMs: switchAt.getTime(),
    }), switchAt.getTime()),
  );
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).igtActive, false);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p2')).igtActive, true);
  assert.equal((await context.shadow.coreProfiles.getAppState()).activePlayerUUID, 'p2');
  assert.equal((await context.shadow.socialWorld.getInterval('switch-task')).closeReason, 'profile-switch');
  assert.equal((await context.shadow.socialWorld.getOpenInterval('p2')).location, SEMANTIC_LOCATION.commons);

  const duplicate = await context.shadow.coreProfiles.switchProfile({
    fromPlayerId: 'p1', toPlayerId: 'p2', operationId: 'switch-presence', now: switchAt,
    commonsVisible: true, commonsIntervalId: 'p2-commons',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(await context.client.query({
    sql: "SELECT COUNT(*) FROM semantic_presence_intervals WHERE id='p2-commons'",
    result: 'value',
  }), 1);
});

test('prepared query separates recent traces from intervals and never invents duration', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.planning.import({
    tasks: [
      {
        UUID: 'legacy-task', parent: 'p2', name: 'Recorded completion',
        completedAt: origin.toISOString(), completedInGameTimestamp: 10_000,
      },
      {
        UUID: 'legacy-task-without-igt', parent: 'p1', name: 'Unpositioned completion',
        completedAt: origin.toISOString(),
      },
    ],
  });
  const query = new SocialWorldQueryService({
    repository: context.shadow.socialWorld,
    client: context.client,
    now: () => origin,
  });
  const presence = await query.getProfilePresence({
    profileId: 'p2', viewerIGT: 20_000, isActiveProfile: false,
  });
  assert.equal(presence.state, PRESENCE_STATE.recent);
  assert.equal(presence.location, SEMANTIC_LOCATION.taskSession);
  assert.equal(presence.elapsedHere, null);
  assert.equal(presence.activeElapsed, null);
  assert.match(presence.presentation.secondary, /Duration unavailable/);

  const earlier = await query.getProfilePresence({
    profileId: 'p2', viewerIGT: 9_999, isActiveProfile: false,
  });
  assert.equal(earlier.state, PRESENCE_STATE.inactive);
  assert.equal(earlier.lastActiveIGT, null);

  const unpositioned = await query.getProfilePresence({
    profileId: 'p1', viewerIGT: 20_000, isActiveProfile: false,
  });
  assert.equal(unpositioned.state, PRESENCE_STATE.inactive);
  assert.equal(unpositioned.lastActiveIGT, null);
});
