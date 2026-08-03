import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
let source = await readFile(new URL('./MatchPromiseReward.js', import.meta.url), 'utf8');
source = source
  .replace("import { getMatchDurationMs } from './MatchContracts.js';", "const getMatchDurationMs = (match) => Number(match?.rulesSnapshot?.durationMs || 0);")
  .replace("import { getAversionWeight, getUrgencyWeight } from '../tasks/Tasks.js';", "const getAversionWeight = (task) => 0.6 + 0.4 * Math.max(1, Math.min(3, Number(task?.aversion || 1))); const getUrgencyWeight = () => 2;")
  .replace("import { calculateWeightedEffectDuration } from './EffectIntervals.js';", "const calculateWeightedEffectDuration = () => ({ activeMs: 0, weightedActiveMs: 0, averageMultiplier: 1, segments: [] });");
const {
  buildMatchPromiseContract,
  calculateMatchPromiseScore,
  MATCH_PROMISE_POLICY_ID,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const match = {
  UUID: 'match-1',
  lockedAt: '2026-08-01T12:00:00.000Z',
  rulesSnapshot: {
    rulesetId: 'pair_match_v1',
    durationMs: 60 * 60_000,
    scoreRewardPolicy: MATCH_PROMISE_POLICY_ID,
    maxPromiseScalar: 1.5,
  },
};
const task = {
  UUID: 'task-1',
  parent: 'p1',
  aversion: 1,
  dueDate: '2026-08-02T12:00:00.000Z',
  createdAt: '2026-07-01T12:00:00.000Z',
};

function contractAt(ratio, options = {}) {
  return buildMatchPromiseContract({
    match,
    task: options.task || task,
    activeEffects: options.activeEffects || [],
    promisedMs: ratio * 60 * 60_000,
    acceptedAt: options.acceptedAt || '2026-08-01T12:00:00.000Z',
  });
}

test('promise scalar grows linearly from 1 to 1.5 across the Match duration', () => {
  for (const [ratio, expected] of [[0, 1], [0.25, 1.125], [0.5, 1.25], [1, 1.5]]) {
    const contract = contractAt(ratio);
    const result = calculateMatchPromiseScore({ contract, activeDurationMs: contract.promisedMs });
    assert.equal(result.promiseScalar, ratio === 0 ? 1 : expected);
  }
});

test('missing a promise keeps task and event multipliers while removing only the promise scalar', () => {
  const contract = contractAt(0.5, { activeEffects: [{ UUID: 'buff', multiplierValue: 1.2 }] });
  const missed = calculateMatchPromiseScore({ contract, activeDurationMs: 20 * 60_000 });
  const met = calculateMatchPromiseScore({ contract, activeDurationMs: 30 * 60_000 });
  assert.equal(missed.promiseMet, false);
  assert.equal(missed.promiseScalar, 1);
  assert.equal(missed.taskMultiplier, contract.taskMultiplier);
  assert.equal(missed.eventMultiplier, 1.2);
  assert.equal(met.promiseMet, true);
  assert.equal(met.promiseScalar, 1.25);
});

test('promises and active time are capped at the remaining immutable Match window', () => {
  const contract = contractAt(1, { acceptedAt: '2026-08-01T12:45:00.000Z' });
  assert.equal(contract.promisedMs, 15 * 60_000);
  const result = calculateMatchPromiseScore({
    contract,
    activeDurationMs: 30 * 60_000,
    boundaryAt: '2026-08-01T13:30:00.000Z',
  });
  assert.equal(result.eligibleActiveMs, 15 * 60_000);
  assert.equal(result.promiseRatio, 0.25);
  assert.equal(result.promiseScalar, 1.125);
});

test('legacy Matches without the immutable promise policy do not create a contract', () => {
  assert.equal(buildMatchPromiseContract({
    match: { ...match, rulesSnapshot: { durationMs: 60 * 60_000 } },
    task,
    promisedMs: 30 * 60_000,
  }), null);
});
