import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('./MatchCompletionService.js', import.meta.url), 'utf8'))
  .replace("import { MATCH_STATUS, STORES } from '@domain/constants.js';", "const MATCH_STATUS = { complete: 'complete' }; const STORES = { match: 'matches', player: 'players' };")
  .replace("import { computeEloChanges } from '@domain/matches/Elo.js';", `const computeEloChanges = (_teams, scores, forced) => ({
    changes: { p1: { change: forced === 0 ? -20 : 25, breakdown: [{ label: 'result', value: forced === 0 ? -20 : 25 }] } },
    winnerTeamIdx: forced === 0 ? 1 : 0,
    t1Total: Number(scores.p1 || 0),
    t2Total: Number(scores.p2 || 0),
  });`)
  .replace("import { getMatchTeams, withImmutableMatchSnapshots } from '@domain/matches/MatchContracts.js';", "const getMatchTeams = (match) => match.teams; const withImmutableMatchSnapshots = (match) => match;")
  .replace("import { getRankGroupFloor } from '@domain/rank/Rank.js';", "const getRankGroupFloor = () => 0;")
  .replace("import { getCurrentIGT } from '@domain/time/Time.js';", "const getCurrentIGT = () => 100;");
const service = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('primary match completion atomically commits only result and immediate player reward', async () => {
  const calls = [];
  const db = {
    async commitAtomicMutation(input) { calls.push(input); },
  };
  const match = {
    UUID: 'm1', parent: 'p1', createdAt: '2026-01-01T00:00:00.000Z', duration: 1,
    teams: [[{ UUID: 'p1', elo: 1000 }], [{ UUID: 'p2', elo: 1000 }]],
  };
  const result = await service.completeMatchPrimary({
    databaseConnection: db,
    match,
    currentPlayer: { UUID: 'p1', elo: 1000 },
    finalScores: { p1: 200, p2: 100 },
  });
  assert.equal(result.match.status, 'complete');
  assert.equal(result.player.elo, 1025);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'match-primary-completion');
  assert.equal(calls[0].queueDerived, false);
  assert.deepEqual(calls[0].puts.map((entry) => entry.store), ['matches', 'players']);
  assert.equal(result.match.result.highlights, undefined);
  assert.equal(result.match.location, undefined);
});
