import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./MatchScoring.js', import.meta.url), 'utf8');
source = source
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { matchScoreEvent: 'matchScoreEvents', actionSession: 'actionSessions' };")
  .replace(
    "import { getMatchRules, PAIR_MATCH_RULESET_ID } from './MatchContracts.js';",
    "const PAIR_MATCH_RULESET_ID = 'pair_match_v1'; const getMatchRules = (match) => match.rulesSnapshot || match;",
  )
  .replace(
    "import { calculateMatchPromiseScore } from './MatchPromiseReward.js';",
    `const calculateMatchPromiseScore = ({ contract, activeDurationMs, boundaryAt }) => {
      const boundary = Math.min(new Date(boundaryAt).getTime(), new Date(contract.matchEndsAt).getTime());
      const windowMs = Math.max(0, boundary - new Date(contract.acceptedAt).getTime());
      const eligibleActiveMs = Math.min(activeDurationMs, windowMs);
      const basePoints = Math.floor(eligibleActiveMs / 10000);
      const promiseRatio = contract.promisedMs / contract.matchDurationMs;
      const promiseMet = eligibleActiveMs >= contract.promisedMs;
      const promiseScalar = promiseMet ? 1 + 0.5 * promiseRatio : 1;
      return { policyId: 'match-promise-v1', policyVersion: 1, boundaryAt: new Date(boundary).toISOString(), eligibleActiveMs, basePoints, taskMultiplier: contract.taskMultiplier, eventMultiplier: contract.eventMultiplier, promisedMs: contract.promisedMs, promiseRatio, promiseMet, promiseScalar, totalMultiplier: contract.taskMultiplier * contract.eventMultiplier * promiseScalar, points: Math.floor(basePoints * contract.taskMultiplier * contract.eventMultiplier * promiseScalar) };
    };`,
  );
const scoring = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function memoryDatabase() {
  const stores = new Map([
    ['actionSessions', new Map()],
    ['matchScoreEvents', new Map()],
  ]);
  return {
    stores,
    commits: [],
    async get(store, id) { return stores.get(store)?.get(id) || null; },
    async commitAtomicMutation(command) {
      this.commits.push(command);
      for (const put of command.puts) stores.get(put.store).set(put.record.UUID, put.record);
    },
  };
}

test('Match boundary finalization freezes eligible time and is idempotent', async () => {
  const database = memoryDatabase();
  const match = {
    UUID: 'match-1',
    rulesSnapshot: { eligibleTaskUUIDs: ['todo-1'], eligibleGoalUUIDs: [], eligibleMilestoneUUIDs: [] },
  };
  const actionSession = {
    UUID: 'session-1',
    parent: 'player-1',
    matchUUID: 'match-1',
    targetType: 'todo',
    targetUUID: 'todo-1',
    targetName: 'Write the section',
    outcome: 'active',
    matchRewardContract: {
      policyId: 'match-promise-v1',
      policyVersion: 1,
      acceptedAt: '2026-08-01T12:00:00.000Z',
      matchEndsAt: '2026-08-01T13:00:00.000Z',
      matchDurationMs: 60 * 60_000,
      promisedMs: 30 * 60_000,
      taskMultiplier: 2,
      eventMultiplier: 1.25,
    },
  };
  database.stores.get('actionSessions').set(actionSession.UUID, actionSession);

  const first = await scoring.finalizeMatchActionSessionScore(database, {
    match,
    participantUUID: 'player-1',
    actionSession,
    activeDurationMs: 70 * 60_000,
    boundaryAt: '2026-08-01T13:10:00.000Z',
  });
  assert.equal(first.scoreBreakdown.eligibleActiveMs, 60 * 60_000);
  assert.equal(first.scoreBreakdown.promiseScalar, 1.25);
  assert.equal(first.scoreEvent.points, 1125);
  assert.equal(first.actionSession.matchScoreFinalizedAt, '2026-08-01T13:10:00.000Z');

  const second = await scoring.finalizeMatchActionSessionScore(database, {
    match,
    participantUUID: 'player-1',
    actionSession,
    activeDurationMs: 90 * 60_000,
    boundaryAt: '2026-08-01T13:30:00.000Z',
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.scoreEvent.points, 1125);
  assert.equal(database.commits.length, 1);
  assert.equal(database.stores.get('matchScoreEvents').size, 1);
});
