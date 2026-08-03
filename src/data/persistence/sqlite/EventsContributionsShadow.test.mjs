import assert from 'node:assert/strict';
import test from 'node:test';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-12T23:00:00.000Z');

async function setup() {
  const context = await createShadowTestContext({ now: () => fixed });
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'p1', username: 'Alpha', elo: 1000, createdAt: fixed.toISOString() },
      { UUID: 'p2', username: 'Beta', elo: 1000, createdAt: fixed.toISOString() },
    ], appState: { activePlayerUUID: 'p1' },
  });
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'goal-1', parent: 'p1', name: 'Launch' }, { UUID: 'goal-2', parent: 'p2', name: 'Historical' }],
    todos: [{ UUID: 'todo-1', parent: 'p1', projectId: 'goal-1', name: 'Todo' }],
    tasks: [{ UUID: 'task-1', parent: 'p1', projectId: 'goal-1', todoUUID: 'todo-1', name: 'Task' }],
  });
  return context;
}

function fixture() {
  return {
    events: [
      { UUID: 'life-1', parent: 'p1', type: 'wake', name: 'Wake', createdAt: '2026-07-12T20:00:00.000Z', inGameTimestamp: 10, location: { latitude: 32.77, longitude: -96.79, accuracy: 12 } },
      { UUID: 'life-future', parent: 'p1', type: 'end_work', name: 'End', createdAt: '2026-07-13T00:00:00.000Z', inGameTimestamp: 1000, location: { latitude: 32.78, longitude: -96.80 } },
    ],
    customEvents: [
      { UUID: 'one-time-1', ownerUUID: 'p1', type: 'one_time', name: 'Hydrate', currentEraId: 'era-1', trackingEras: [{ UUID: 'era-1', type: 'one_time', startedAt: '2026-07-10T00:00:00.000Z', inGameTimestamp: 0 }], createdAt: '2026-07-10T00:00:00.000Z', updatedAt: fixed.toISOString(), bannerImageUrl: 'data:image/png;base64,AAAA' },
      { UUID: 'quantity-1', ownerUUID: 'p1', type: 'quantity', name: 'Pages', dailyTarget: 10, unit: 'pages', currentEraId: 'era-2', trackingEras: [{ UUID: 'era-2', type: 'quantity', startedAt: '2026-07-10T00:00:00.000Z', inGameTimestamp: 0 }], createdAt: '2026-07-10T00:00:00.000Z' },
    ],
    eventLogs: [
      { UUID: 'log-1', parent: 'p1', eventUUID: 'one-time-1', type: 'one_time', status: 'success', action: 'complete', trackingEraId: 'era-1', value: 1, loggedAt: '2026-07-12T20:10:00.000Z', createdAt: '2026-07-12T20:10:00.000Z', inGameTimestamp: 20, location: { latitude: 32.771, longitude: -96.791 } },
      { UUID: 'log-2', parent: 'p1', eventUUID: 'quantity-1', type: 'quantity', status: 'success', action: 'add', trackingEraId: 'era-2', value: 7, loggedAt: '2026-07-12T21:00:00.000Z', createdAt: '2026-07-12T21:00:00.000Z', inGameTimestamp: 30 },
    ],
    eventBuffs: [
      { UUID: 'buff-active', parent: 'p1', eventUUID: 'one-time-1', multiplierValue: 1.1, createdAt: '2026-07-12T20:00:00.000Z', expiresAt: '2026-07-13T00:00:00.000Z' },
      { UUID: 'buff-expired', parent: 'p1', eventUUID: 'one-time-1', multiplierValue: 1.2, createdAt: '2026-07-10T20:00:00.000Z', expiresAt: '2026-07-11T00:00:00.000Z' },
    ],
    contributions: [
      { UUID: 'contrib-1', parent: 'p1', projectId: 'goal-1', taskUUID: 'task-1', todoUUID: 'todo-1', taskName: 'Task', source: 'task', completionEventUUID: 'completion-1', value: 3.5, rewardCoins: 2, playerNameSnapshot: 'Alpha', goalNameSnapshot: 'Launch', createdAt: '2026-07-12T20:30:00.000Z', inGameTimestamp: 25, location: { latitude: 32.772, longitude: -96.792 } },
    ],
  };
}

test('Batch 19 imports event history, buffs, and contributions with temporal parity', async (t) => {
  const context = await setup();
  t.after(context.close);
  const imported = await context.shadow.importers.events.import(fixture());
  assert.deepEqual(imported.counts, { events: 2, customEvents: 2, eventLogs: 2, eventBuffs: 2, contributions: 1, diagnostics: 1 });
  assert.equal(imported.diagnostics[0].reason, 'inline-banner-requires-resource-import');

  const logs = await context.shadow.events.getEventLogsForEvent('one-time-1', { playerId: 'p1', viewerIGT: 25 });
  assert.deepEqual(logs.map((row) => row.UUID), ['log-1']);
  const buffs = await context.shadow.events.getActiveBuffs('p1', { at: fixed });
  assert.deepEqual(buffs.map((row) => row.UUID), ['buff-active']);
  const contributions = await context.shadow.events.getContributionsForGoal('goal-1');
  assert.equal(contributions.length, 1);
  assert.equal(contributions[0].value, 3.5);
  assert.equal((await context.shadow.events.getContributionForTask('task-1')).UUID, 'contrib-1');

  assert.equal((await context.shadow.importers.events.import(fixture())).duplicate, true);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 19 special-event seeding and contribution replay are idempotent', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.events.import(fixture());
  await context.shadow.events.seedSpecialEvents({ operationId: 'seed-1' });
  await context.shadow.events.seedSpecialEvents({ operationId: 'seed-1' });
  const special = await context.client.query({ sql: "SELECT COUNT(*) FROM custom_events WHERE event_type='special'", result: 'value' });
  assert.equal(special, 4);

  const record = {
    UUID: 'contrib-replay', parent: 'p1', goalUUID: 'goal-1', taskUUID: 'task-1',
    completionEventUUID: 'completion-replay', source: 'task', summary: 'Replay', value: 2,
  };
  const first = await context.shadow.events.recordContribution(record, { operationId: 'contrib-op-1' });
  const replay = await context.shadow.events.recordContribution({ ...record, UUID: 'other-id', value: 99 }, { operationId: 'contrib-op-2' });
  assert.equal(first.UUID, 'contrib-replay');
  assert.equal(replay.UUID, 'contrib-replay');
  assert.equal(Number(replay.value), 2);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM contributions WHERE completion_event_id='completion-replay'", result: 'value' }), 1);

  await context.shadow.events.clearBuffs('p1', { operationId: 'clear-1' });
  await context.shadow.events.clearBuffs('p1', { operationId: 'clear-1' });
  assert.equal((await context.shadow.events.getActiveBuffs('p1')).length, 0);
});

test('Batch 19 profile wipe clears current buffs but retains historical event and contribution facts', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.events.import({
    events: [{ UUID: 'p2-event', parent: 'p2', type: 'wake', createdAt: fixed.toISOString(), location: { latitude: 40, longitude: -70 } }],
    customEvents: [{ UUID: 'p2-custom', ownerUUID: 'p2', type: 'one_time', name: 'Private habit', currentEraId: 'p2-era', trackingEras: [{ UUID: 'p2-era', type: 'one_time', startedAt: fixed.toISOString(), inGameTimestamp: 0 }], createdAt: fixed.toISOString() }],
    eventBuffs: [{ UUID: 'p2-buff', parent: 'p2', eventUUID: 'p2-custom', multiplierValue: 1.1, createdAt: fixed.toISOString() }],
    contributions: [{ UUID: 'p2-contribution', parent: 'p2', projectId: 'goal-2', source: 'manual', summary: 'Historical', value: 4, playerNameSnapshot: 'Beta', goalNameSnapshot: 'Historical', createdAt: fixed.toISOString(), location: { latitude: 41, longitude: -71 } }],
  });
  await context.shadow.coreProfiles.wipeProfile('p2', { operationId: 'wipe-events-p2', now: fixed });
  const event = await context.client.query({ sql: "SELECT player_id AS playerId,latitude,longitude FROM lifecycle_events WHERE id='p2-event'", result: 'one' });
  const contribution = await context.client.query({ sql: "SELECT player_id AS playerId,player_name_snapshot AS playerName,latitude,longitude FROM contributions WHERE id='p2-contribution'", result: 'one' });
  assert.equal(event.playerId, null);
  assert.equal(Number(event.latitude), 40);
  assert.equal(contribution.playerId, null);
  assert.equal(contribution.playerName, 'Beta');
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM event_buffs WHERE id='p2-buff'", result: 'value' }), 0);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});
