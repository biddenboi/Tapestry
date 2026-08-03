import assert from 'node:assert/strict';
import test from 'node:test';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';
import DojoStandingsService from '../services/DojoStandingsService.js';

async function seedPlayers(client, ids) {
  await client.executeAtomic({
    commandId: `seed-players:${ids.join(':')}`,
    label: 'seed-dojo-standing-players',
    statements: ids.map((id) => ({
      sql: `INSERT INTO players(id,username,created_at,updated_at) VALUES(?,?,?,?)`,
      bind: [id, id.toUpperCase(), '2026-07-14T12:00:00.000Z', '2026-07-14T12:00:00.000Z'],
      result: 'changes',
    })),
  });
}

test('Dojo presence and task completion maintain one idempotent provisional/final rollup', async (t) => {
  const context = await createShadowTestContext();
  t.after(() => context.close());
  context.shadow.dojoStandings.schedule = () => null;
  await seedPlayers(context.client, ['self']);

  await context.shadow.socialWorld.transitionPresence({
    intervalId: 'presence-self-dojo',
    playerId: 'self',
    location: 'dojo',
    sourceType: 'dojo-session',
    sourceId: 'session-self',
    startedIGT: 1_000,
    enteredAt: '2026-07-14T12:00:00.000Z',
    commandId: 'enter-self-dojo',
  });
  let rollup = await context.client.query({
    sql: `SELECT * FROM dojo_session_rollups WHERE session_id='session-self'`,
    result: 'one',
  });
  assert.equal(rollup.status, 'provisional');
  assert.equal(rollup.points, 0);
  assert.equal(rollup.boundary_claim, 'exact');

  await context.client.executeAtomic({
    commandId: 'seed-task-self',
    label: 'seed-dojo-task',
    statements: [{
      sql: `INSERT INTO tasks(
              id,player_id,name,points,source,created_at,completed_at,extra_json
            ) VALUES(?,?,?,?,?,?,?,?)`,
      bind: [
        'task-self', 'self', 'Focused work', 12, 'dojo',
        '2026-07-14T12:00:05.000Z', '2026-07-14T12:00:55.000Z',
        JSON.stringify({ dojoSessionUUID: 'session-self' }),
      ],
      result: 'changes',
    }],
  });
  const task = {
    UUID: 'task-self', parent: 'self', source: 'dojo', dojoSessionUUID: 'session-self',
    points: 12, completedAt: '2026-07-14T12:00:55.000Z',
  };
  const first = await context.shadow.dojoStandings.recordTaskCompletion({ task });
  const replay = await context.shadow.dojoStandings.recordTaskCompletion({ task });
  rollup = await context.client.query({
    sql: `SELECT * FROM dojo_session_rollups WHERE session_id='session-self'`,
    result: 'one',
  });
  assert.equal(first.updated, true);
  assert.equal(replay.duplicate, true);
  assert.equal(rollup.points, 12);
  assert.equal(rollup.task_count, 1);
  assert.equal(rollup.status, 'provisional');

  await context.shadow.socialWorld.closePresence({
    playerId: 'self',
    endedIGT: 61_000,
    exitedAt: '2026-07-14T12:01:00.000Z',
    closeReason: 'surface-exit',
    expectedLocation: 'dojo',
    commandId: 'leave-self-dojo',
  });
  rollup = await context.client.query({
    sql: `SELECT * FROM dojo_session_rollups WHERE session_id='session-self'`,
    result: 'one',
  });
  assert.equal(rollup.status, 'complete');
  assert.equal(rollup.ended_igt, 61_000);
  assert.equal(rollup.focused_ms, 60_000);
  assert.equal(rollup.points, 12);
});

test('rank materialization is deterministic and around-me reads stay bounded', async (t) => {
  const context = await createShadowTestContext();
  t.after(() => context.close());
  const ids = ['self', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  await seedPlayers(context.client, ids);
  const points = [12, 50, 40, 30, 20, 10, 5];
  await context.client.executeAtomic({
    commandId: 'seed-ranked-dojo-sessions',
    label: 'seed-ranked-dojo-sessions',
    statements: [
      ...ids.map((playerId, index) => ({
        sql: `INSERT INTO dojo_session_rollups(
                session_id,player_id,focused_ms,points,task_count,status,boundary_claim,last_activity_at,source_version
              ) VALUES(?,?,0,?,1,'complete','partial',?,1)`,
        bind: [`session-${playerId}`, playerId, points[index], `2026-07-14T12:0${index}:00.000Z`],
        result: 'changes',
      })),
      {
        sql: `UPDATE source_versions SET version=version+1,updated_at=? WHERE source_key='dojoStandings'`,
        bind: ['2026-07-14T13:00:00.000Z'],
        result: 'changes',
      },
    ],
  });

  await context.shadow.dojoStandings.materializeRanks();
  const standings = await context.shadow.dojoStandings.getStandings({
    playerId: 'self', currentSessionId: 'session-self', aroundRadius: 2, topLimit: 3,
  });
  assert.equal(standings.updating, false);
  assert.deepEqual(standings.top.map((row) => row.points), [50, 40, 30]);
  assert.equal(standings.current.position, 5);
  assert.deepEqual(standings.around.map((row) => row.position), [3, 4, 5, 6, 7]);
  assert.equal(standings.around.length, 5);

  const firstOrder = await context.client.query({
    sql: 'SELECT session_id AS sessionId,position FROM dojo_session_ranks ORDER BY position',
    result: 'all',
  });
  await context.client.executeAtomic({
    commandId: 'force-rank-rebuild',
    label: 'force-rank-rebuild',
    statements: [{
      sql: `UPDATE source_versions SET version=version+1,updated_at=? WHERE source_key='dojoStandings'`,
      bind: ['2026-07-14T13:01:00.000Z'],
      result: 'changes',
    }],
  });
  await context.shadow.dojoStandings.materializeRanks();
  const secondOrder = await context.client.query({
    sql: 'SELECT session_id AS sessionId,position FROM dojo_session_ranks ORDER BY position',
    result: 'all',
  });
  assert.deepEqual(secondOrder, firstOrder);
});
