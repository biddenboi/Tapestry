import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('./MatchCompletionService.js', import.meta.url), 'utf8'))
  .replace("import { MATCH_STATUS } from '@domain/constants.js';", "const MATCH_STATUS = { complete: 'complete' }; const STORES = { match: 'matches', player: 'players', worldConsequenceReceipt: 'worldConsequenceReceipts', rewardProvenance: 'rewardProvenance' };")
  .replace(`import {
  computeLegacyEloChanges,
  computePairMatchEloChanges,
} from '@domain/matches/Elo.js';`, `const computeLegacyEloChanges = (_teams, scores, forced) => ({
    changes: { p1: { change: forced === 0 ? -20 : 25, breakdown: [{ label: 'result', value: forced === 0 ? -20 : 25 }] } },
    winnerTeamIdx: forced === 0 ? 1 : 0,
    t1Total: Number(scores.p1 || 0),
    t2Total: Number(scores.p2 || 0),
  });
const computePairMatchEloChanges = computeLegacyEloChanges;`)
  .replace(`import {
  getMatchTeams,
  isPairMatch,
  withImmutableMatchSnapshots,
} from '@domain/matches/MatchContracts.js';`, "const getMatchTeams = (match) => match.teams; const isPairMatch = () => false; const withImmutableMatchSnapshots = (match) => match;")
  .replace("import { getRankGroupFloor } from '@domain/rank/Rank.js';", "const getRankGroupFloor = () => 0;")
  .replace("import { getCurrentIGT } from '@domain/time/Time.js';", "const getCurrentIGT = () => 100;")
  .replace("import { createRewardProvenance } from '@domain/rewards/RewardProvenance.js';", "const createRewardProvenance = (input) => ({ UUID: 'provenance:' + input.sourceEventUUID, ...input });")
  .replace("import { createWorldConsequenceReceipt } from '@domain/world-consequences/WorldConsequencePolicy.js';", "const createWorldConsequenceReceipt = (input) => ({ UUID: 'world:' + input.sourceEventUUID, ...input });");
const withMatchSync = source.replace(
  "import { saveMatchStateCommand } from './MatchSyncCommands.js';",
  `const saveMatchStateCommand = (db, match, options) => db.commitAtomicMutation({
    operationId: options.operationId,
    label: options.label,
    queueDerived: false,
    puts: [
      { store: STORES.match, record: match },
      options.player ? { store: STORES.player, record: options.player } : null,
      options.worldReceipt ? { store: STORES.worldConsequenceReceipt, record: options.worldReceipt } : null,
      options.rewardProvenance ? { store: STORES.rewardProvenance, record: options.rewardProvenance } : null,
    ].filter(Boolean),
  });`,
);
const serviceSource = withMatchSync.replace(
  "import { isRatedMatch, matchRatingMode, MATCH_RATING_MODE } from '@domain/matches/RatingMode.js';",
  `const MATCH_RATING_MODE = { rated: 'rated', unrated: 'unrated' };
const matchRatingMode = (match, fallback) => match.ratingMode || fallback;
const isRatedMatch = (match) => match.ratingMode == null ? match.status === 'complete' : match.ratingMode === 'rated';`,
);
const service = await import(`data:text/javascript;base64,${Buffer.from(serviceSource).toString('base64')}`);

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
  assert.equal(result.match.ratingMode, 'rated');
  assert.equal(result.match.completedInGameTimestamp, 100);
  assert.equal(result.match.result.inGameTimestamp, 100);
  assert.equal(result.player.elo, 1025);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'match-primary-completion');
  assert.equal(calls[0].queueDerived, false);
  assert.deepEqual(calls[0].puts.map((entry) => entry.store), [
    'matches',
    'players',
    'worldConsequenceReceipts',
    'rewardProvenance',
  ]);
  assert.equal(result.match.result.highlights, undefined);
  assert.equal(result.match.location, undefined);
});

test('an explicit unrated match completes without changing stored Elo', async () => {
  const calls = [];
  const db = { async commitAtomicMutation(input) { calls.push(input); } };
  const result = await service.completeMatchPrimary({
    databaseConnection: db,
    match: {
      UUID: 'm2', parent: 'p1', ratingMode: 'unrated', duration: 1,
      teams: [[{ UUID: 'p1', elo: 1000 }], [{ UUID: 'p2', elo: 1000 }]],
    },
    currentPlayer: { UUID: 'p1', elo: 1000 },
    finalScores: { p1: 200, p2: 100 },
  });
  assert.equal(result.match.ratingMode, 'unrated');
  assert.equal(result.player.elo, 1000);
  assert.equal(result.immediateReward.eloChange, 0);
  assert.equal(result.match.result.eloChange, 0);
  assert.equal(result.match.result.oldElo, 1000);
  assert.equal(result.match.result.newElo, 1000);
  assert.deepEqual(result.match.result.eloBreakdown, []);
  assert.equal(calls[0].puts.find((entry) => entry.store === 'players').record.elo, 1000);
  assert.equal(calls[0].puts.some((entry) => entry.store === 'rewardProvenance'), false);
});

test('primary completion preserves recorded match elapsed time without inventing zero', () => {
  const calculated = service.calculateMatchPrimaryResult({
    match: {
      UUID: 'm3', parent: 'p1', duration: 1,
      teams: [[{ UUID: 'p1', elo: 1000 }], [{ UUID: 'p2', elo: 1000 }]],
    },
    currentPlayer: { UUID: 'p1', elo: 1000 },
    finalScores: { p1: 200, p2: 100 },
    eventHistory: [
      {
        id: 'recorded',
        type: 'lead_change',
        message: 'Lead changed.',
        matchElapsedMs: 73_456,
        timelineAt: '2026-01-01T00:01:13.456Z',
      },
      {
        id: 'legacy',
        type: 'match_update',
        message: 'Old event.',
      },
    ],
  });

  const [recorded, legacy] = calculated.result.postMatchInput.eventHistory;
  assert.equal(recorded.matchElapsedMs, 73_456);
  assert.equal(recorded.timelineAt, '2026-01-01T00:01:13.456Z');
  assert.equal(legacy.matchElapsedMs, null);
});

test('primary completion stores the viewer Match score audit breakdown for recap', () => {
  const calculated = service.calculateMatchPrimaryResult({
    match: {
      UUID: 'm4', parent: 'p1', duration: 1,
      teams: [[{ UUID: 'p1', elo: 1000 }], [{ UUID: 'p2', elo: 1000 }]],
    },
    currentPlayer: { UUID: 'p1', elo: 1000 },
    finalScores: { p1: 225, p2: 100 },
    scoreEvents: [{
      UUID: 'match-score:m4:p1:s1',
      matchUUID: 'm4',
      participantUUID: 'p1',
      actionSessionUUID: 's1',
      points: 225,
      evidence: { matchReward: {
        basePoints: 100,
        taskMultiplier: 1.5,
        eventMultiplier: 1.2,
        promiseScalar: 1.25,
        promiseMet: true,
      } },
    }],
  });
  assert.deepEqual(calculated.result.matchScoreBreakdowns, [{
    scoreEventUUID: 'match-score:m4:p1:s1',
    actionSessionUUID: 's1',
    occurredAt: null,
    basePoints: 100,
    taskMultiplier: 1.5,
    eventMultiplier: 1.2,
    promiseScalar: 1.25,
    promiseMet: true,
    points: 225,
  }]);
});
