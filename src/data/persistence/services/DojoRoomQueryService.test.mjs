import assert from 'node:assert/strict';
import test from 'node:test';
import DojoRoomQueryService from './DojoRoomQueryService.js';
import { createShadowTestContext } from '../sqlite/shadowDomainTestUtils.mjs';

test('Dojo room facts use one bounded batched task query for every occupant', async () => {
  const calls = [];
  const service = new DojoRoomQueryService({
    client: {
      async query(statement) {
        calls.push(statement);
        return [
          { profileId: 'friend', sessionId: 'friend-session', sessionPoints: 30, taskLabel: 'Write', taskId: 't1', taskCompletedIGT: 900 },
          { profileId: 'viewer', sessionId: 'viewer-session', sessionPoints: 12, taskLabel: null, taskId: null, taskCompletedIGT: null },
        ];
      },
    },
  });
  const facts = await service.getRoomFacts({
    occupants: [
      { profileId: 'viewer', sessionId: 'viewer-session' },
      { profileId: 'friend', sessionId: 'friend-session' },
      { profileId: 'friend', sessionId: 'duplicate-must-not-query' },
    ],
    viewerIGT: 1_000,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM json_each\(\?\)/);
  assert.match(calls[0].sql, /json_extract\(t\.extra_json,'\$\.dojoSessionUUID'\)/);
  assert.deepEqual(JSON.parse(calls[0].bind[0]), [
    { profileId: 'viewer', sessionId: 'viewer-session' },
    { profileId: 'friend', sessionId: 'friend-session' },
  ]);
  assert.equal(facts[0].sessionPoints, 30);
  assert.equal(facts[1].taskLabel, null);
});

test('an empty room performs no query', async () => {
  let queried = false;
  const service = new DojoRoomQueryService({ client: { query: async () => { queried = true; return []; } } });
  assert.deepEqual(await service.getRoomFacts({ occupants: [] }), []);
  assert.equal(queried, false);
});

test('the SQLite join returns only session-matched task facts through the viewer boundary', async (t) => {
  const context = await createShadowTestContext();
  t.after(context.close);
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'viewer', username: 'Viewer' },
      { UUID: 'friend', username: 'Friend' },
    ],
    appState: { activePlayerUUID: 'viewer' },
    economyState: { globalMoney: 0 },
    settings: [],
  });
  await context.shadow.importers.planning.import({
    tasks: [
      { UUID: 'v1', parent: 'viewer', name: 'Viewer work', source: 'dojo', dojoSessionUUID: 'viewer-session', completedAt: '2026-07-12T10:00:00.000Z', completedInGameTimestamp: 800, points: 11 },
      { UUID: 'f1', parent: 'friend', name: 'Friend early', source: 'dojo', dojoSessionUUID: 'friend-session', completedAt: '2026-07-12T10:00:00.000Z', completedInGameTimestamp: 700, points: 7 },
      { UUID: 'f2', parent: 'friend', name: 'Friend latest', source: 'dojo', dojoSessionUUID: 'friend-session', completedAt: '2026-07-12T11:00:00.000Z', completedInGameTimestamp: 900, points: 13 },
      { UUID: 'future', parent: 'friend', name: 'Beyond cursor', source: 'dojo', dojoSessionUUID: 'friend-session', completedAt: '2026-07-12T12:00:00.000Z', completedInGameTimestamp: 1_100, points: 100 },
      { UUID: 'other', parent: 'friend', name: 'Other visit', source: 'dojo', dojoSessionUUID: 'other-session', completedAt: '2026-07-12T09:00:00.000Z', completedInGameTimestamp: 600, points: 200 },
    ],
  });

  const service = new DojoRoomQueryService({ client: context.client });
  const facts = await service.getRoomFacts({
    occupants: [
      { profileId: 'viewer', sessionId: 'viewer-session' },
      { profileId: 'friend', sessionId: 'friend-session' },
    ],
    viewerIGT: 1_000,
  });
  const byProfile = new Map(facts.map((fact) => [fact.profileId, fact]));
  assert.equal(byProfile.get('viewer').sessionPoints, 11);
  assert.equal(byProfile.get('friend').sessionPoints, 20);
  assert.equal(byProfile.get('friend').taskLabel, 'Friend latest');
});
