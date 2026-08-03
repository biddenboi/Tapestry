import assert from 'node:assert/strict';
import test from 'node:test';
import { stableJson } from './shadowDomainUtils.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const now = new Date('2026-07-12T22:00:00.000Z');

async function setup() {
  const context = await createShadowTestContext({ now: () => now });
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'p1', username: 'Alpha', elo: 1000, tokens: 5, createdAt: now.toISOString() },
      { UUID: 'p2', username: 'Beta', elo: 1100, tokens: 6, createdAt: now.toISOString() },
      { UUID: 'p3', username: 'Gamma', elo: 900, tokens: 7, createdAt: now.toISOString() },
    ],
    appState: { activePlayerUUID: 'p1' },
  });
  return context;
}

function matchFixture(id = 'match-1') {
  return {
    UUID: id,
    parent: 'p1',
    status: 'complete',
    duration: 1.5,
    createdAt: '2026-07-12T20:00:00.000Z',
    inGameTimestamp: 100,
    completedInGameTimestamp: 5500,
    teams: [
      [
        { UUID: 'p1', username: 'Alpha at match', elo: 1000, power: 24, tokens: 999, description: 'must not copy' },
        { UUID: 'ghost-1', username: 'Ghost', elo: 980, power: 20, giantNestedProfile: { private: true } },
      ],
      [{ UUID: 'p2', username: 'Beta at match', elo: 1100, power: 27, tokens: 999 }],
    ],
    participantUUIDs: ['p1','ghost-1','p2'],
    result: {
      winner: 1,
      team1Total: 500,
      team2Total: 480,
      iWon: true,
      wasForfeited: false,
      concludedAt: '2026-07-12T21:30:00.000Z',
      playerEloChanges: {
        p1: { oldElo: 1000, newElo: 1010, change: 10 },
        p2: { oldElo: 1100, newElo: 1090, change: -10 },
      },
    },
  };
}

test('Batch 18 imports normalized historical matches without complete player copies', async (t) => {
  const context = await setup();
  t.after(context.close);
  const fixture = {
    matches: [matchFixture()],
    backgroundJobs: [{ UUID: 'job-1', type: 'post-match', status: 'pending', idempotencyKey: 'job-key-1', matchUUID: 'match-1', payload: { phase: 'elo' }, createdAt: now.toISOString() }],
  };
  const imported = await context.shadow.importers.matches.import(fixture);
  assert.deepEqual(imported.counts, {
    matches: 1, teams: 2, participants: 3, knownParticipants: 2,
    backgroundJobs: 1, backgroundJobReceipts: 0, diagnostics: 0,
  });
  const match = await context.shadow.matches.getMatch('match-1');
  assert.equal(match.duration, 1.5);
  assert.equal(match.teams.length, 2);
  assert.equal(match.teams[0].find((entry) => entry.UUID === 'p1').username, 'Alpha at match');
  assert.equal(match.teams[0].find((entry) => entry.UUID === 'ghost-1').username, 'Ghost');
  assert.equal(match.result.playerEloChanges.p1.change, 10);
  assert.equal(match.result.playerEloChanges.p2.newElo, 1090);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM match_participants WHERE player_id IS NULL", result: 'value' }), 1);
  const metadata = await context.client.query({ sql: 'SELECT metadata_json FROM match_participants ORDER BY id', result: 'values' });
  assert.ok(metadata.every((value) => !String(value).includes('tokens') && !String(value).includes('description') && !String(value).includes('giantNestedProfile')));
  assert.equal(await context.client.query({ sql: "SELECT instr(result_json,'playerEloChanges') FROM matches WHERE id='match-1'", result: 'value' }), 0);
  const list = await context.shadow.matches.listMatchesForPlayer('p2', { viewerIGT: 6000 });
  assert.deepEqual(list.map((entry) => entry.UUID), ['match-1']);
  const plan = await context.shadow.matches.explainPlayerHistory('p2');
  assert.ok(plan.some((row) => String(row.detail || row).includes('match_participants_player_idx')));
  assert.equal((await context.shadow.importers.matches.import(fixture)).duplicate, true);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 18 preserves missing match IGT as null instead of coercing it to zero', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.matches.import({
    matches: [{
      ...matchFixture('match-without-igt'),
      inGameTimestamp: null,
      completedInGameTimestamp: null,
    }],
  });
  const row = await context.client.query({
    sql: `SELECT in_game_timestamp AS startedIGT,
                 completed_in_game_timestamp AS completedIGT
          FROM matches WHERE id='match-without-igt'`,
    result: 'one',
  });
  assert.deepEqual(row, { startedIGT: null, completedIGT: null });
});

test('Batch 18 post-match Elo and job effects commit exactly once and roll back as one transaction', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.matches.import({
    matches: [matchFixture('match-1'), { ...matchFixture('match-2'), createdAt: '2026-07-12T21:00:00.000Z' }],
    backgroundJobs: [{ UUID: 'job-1', jobType: 'post-match', status: 'pending', idempotencyKey: 'job-key-1', matchId: 'match-1', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
  });

  const changes = [
    { playerId: 'p1', oldElo: 1000, newElo: 1010 },
    { playerId: 'p2', oldElo: 1100, newElo: 1090 },
  ];
  await assert.rejects(context.client.executeAtomic({
    commandId: 'simulated-post-match-crash',
    label: 'simulated-post-match-crash',
    statements: [
      { sql: `INSERT INTO post_match_commands(operation_id,match_id,job_id,changes_json,outcome_json,committed_at) VALUES(?,?,?,?,?,?)`, bind: ['post-1','match-1','job-1',stableJson(changes),'{}',now.toISOString()] },
      { sql: 'INSERT INTO missing_post_match_table(id) VALUES(1)' },
    ],
  }));
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).elo, 1000);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM match_elo_receipts WHERE match_id='match-1'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT status FROM background_jobs WHERE id='job-1'", result: 'value' }), 'pending');

  const applied = await context.shadow.matches.applyPostMatch({
    matchId: 'match-1', operationId: 'post-1', jobId: 'job-1', eloChanges: changes, outcome: { winner: 1 },
  });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.duplicate, false);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).elo, 1010);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p2')).elo, 1090);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM match_elo_receipts WHERE match_id='match-1'", result: 'value' }), 2);
  assert.equal(await context.client.query({ sql: "SELECT status FROM background_jobs WHERE id='job-1'", result: 'value' }), 'complete');
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM background_job_receipts WHERE idempotency_key='job-key-1'", result: 'value' }), 1);

  const replay = await context.shadow.matches.applyPostMatch({ matchId: 'match-1', operationId: 'post-1', jobId: 'job-1', eloChanges: changes });
  assert.equal(replay.duplicate, true);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).elo, 1010);

  await assert.rejects(context.shadow.matches.applyPostMatch({
    matchId: 'match-2', operationId: 'post-stale', eloChanges: [{ playerId: 'p3', oldElo: 800, newElo: 810 }],
  }), /post-match-stale-elo/);
  assert.equal((await context.shadow.coreProfiles.getPlayer('p3')).elo, 900);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM post_match_commands WHERE operation_id='post-stale'", result: 'value' }), 0);

  const wipe = await context.shadow.coreProfiles.wipeProfile('p1', { operationId: 'wipe-match-p1', now });
  assert.equal(wipe.retained.historical.matchEloReceipts, 1);
  assert.equal(await context.client.query({ sql: "SELECT player_id FROM match_elo_receipts WHERE match_id='match-1' AND player_key='p1'", result: 'value' }), null);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM match_elo_receipts WHERE match_id='match-1' AND player_key='p1'", result: 'value' }), 1);
  assert.equal(await context.client.query({ sql: "SELECT player_id FROM match_participants WHERE match_id='match-1' AND participant_key='p1'", result: 'value' }), null);
  const retainedMatch = await context.shadow.matches.getMatch('match-1');
  assert.equal(retainedMatch.result.playerEloChanges.p1.newElo, 1010);
  assert.ok(retainedMatch.participantUUIDs.includes('p1'));
});
