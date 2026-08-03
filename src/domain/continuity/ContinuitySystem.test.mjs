import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function dataModule(path, replacements) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const handoffs = await dataModule('./Handoff.js', [
  ["import { v4 as uuid } from 'uuid';", "const uuid = () => 'handoff-1';"],
  ["import { STORES } from '@domain/constants.js';", "const STORES = { handoff: 'handoffs' };"],
]);
const actionPlans = await dataModule('./ActionPlan.js', [
  ["import { v4 as uuid } from 'uuid';", "const uuid = () => 'plan-1';"],
  ["import { STORES } from '@domain/constants.js';", "const STORES = { actionPlan: 'actionPlans' };"],
]);

const arrival = await dataModule('./ArrivalRouter.js', [
  ["import { STORES } from '@domain/constants.js';", "const STORES = {};"],
  ["import { buildSlopeContext, getDisplaySlope } from '@domain/tasks/Tasks.js';", "const buildSlopeContext = () => ({}); const getDisplaySlope = () => 0;"],
  ["import { getActiveHandoff } from './Handoff.js';", "const getActiveHandoff = async () => null;"],
  ["import { reconcileReentryState } from './ReentryPolicy.js';", "const reconcileReentryState = async () => ({ extendedAbsence: false });"],
]);

const rhythms = await dataModule('../events/Rhythms.js', [
  ["import { v4 as uuid } from 'uuid';", "const uuid = () => 'rhythm-1';"],
  ["import { STORES } from '@domain/constants.js';", "const STORES = { rhythmDefinition: 'rhythmDefinitions', rhythmOpportunity: 'rhythmOpportunities' };"],
]);

const notifications = await dataModule('../notifications/NotificationPolicy.js', [
  ["import { STORES } from '@domain/constants.js';", "const STORES = { interventionDecision: 'interventionDecisions' };"],
]);

const matchScoring = await dataModule('../matches/MatchScoring.js', [
  ["import { STORES } from '@domain/constants.js';", "const STORES = { matchScoreEvent: 'matchScoreEvents', actionSession: 'actionSessions' };"],
  [
    "import { getMatchRules, PAIR_MATCH_RULESET_ID } from './MatchContracts.js';",
    "const PAIR_MATCH_RULESET_ID = 'pair_match_v1'; const getMatchRules = (match) => match.rulesSnapshot || match;",
  ],
  [
    "import { calculateMatchPromiseScore } from './MatchPromiseReward.js';",
    "const calculateMatchPromiseScore = ({ activeDurationMs = 0 }) => ({ points: Math.floor(Math.max(0, activeDurationMs) / 10000) });",
  ],
]);

test('arrival priority resumes durable work before plans, deadlines, Goals, and recommendation', () => {
  const selected = arrival.selectArrivalState({
    resumableSession: { type: 'resume' },
    activeHandoff: { type: 'handoff' },
    actionPlans: [{ type: 'planned' }],
    urgentDeadline: { type: 'urgent' },
    goalNextAction: { type: 'goal' },
    recommenderCandidate: { type: 'recommended' },
  });
  assert.equal(selected.type, 'resume');
  assert.equal(arrival.selectArrivalState({}).type, 'unstructured');
});

test('Handoffs preserve a bounded next step and expire without deleting history', () => {
  const record = handoffs.createHandoff({
    playerUUID: 'p1',
    resumeTargetType: 'todo',
    resumeTargetUUID: 't1',
    nextStep: `  ${'x'.repeat(700)}  `,
    expiresAt: '2026-07-29T00:00:00.000Z',
  });
  assert.equal(record.status, 'active');
  assert.equal(record.nextStep.length, 500);
  assert.equal(handoffs.handoffIsRelevant(record, Date.parse('2026-07-28T00:00:00.000Z')), true);
  assert.equal(handoffs.handoffIsRelevant(record, Date.parse('2026-07-30T00:00:00.000Z')), false);
});

test('Action Plans preserve an editable cue and reject inverted windows', () => {
  const plan = actionPlans.createActionPlan({
    playerUUID: 'player-1',
    targetUUID: 'todo-1',
    triggerValue: { cue: 'After dinner, open the checklist.' },
    plannedWindowStart: '2026-07-28T18:00:00.000Z',
    plannedWindowEnd: '2026-07-28T19:00:00.000Z',
  });
  assert.equal(plan.status, 'active');
  assert.equal(plan.triggerValue.cue, 'After dinner, open the checklist.');
  assert.throws(() => actionPlans.createActionPlan({
    playerUUID: 'player-1',
    targetUUID: 'todo-1',
    plannedWindowStart: '2026-07-28T19:00:00.000Z',
    plannedWindowEnd: '2026-07-28T18:00:00.000Z',
  }), /cannot end before/);
});

test('Rhythms generate DST-safe local opportunity windows and report reliability/return', () => {
  const daily = rhythms.createRhythmDefinition({
    playerUUID: 'p1',
    targetUUID: 'habit-1',
    cadenceType: 'weekdays',
    eligibleWeekdays: [1, 3, 5],
  });
  const windows = rhythms.opportunityWindows(
    daily,
    new Date('2026-07-27T12:00:00'),
    new Date('2026-08-02T12:00:00'),
  );
  assert.equal(windows.length, 3);
  const summary = rhythms.summarizeRhythm([
    { status: 'expired', windowStart: '2026-07-27T00:00:00.000Z', windowEnd: '2026-07-28T00:00:00.000Z' },
    { status: 'completed', windowStart: '2026-07-28T00:00:00.000Z', windowEnd: '2026-07-29T00:00:00.000Z', resolvedAt: '2026-07-28T12:00:00.000Z' },
  ], Date.parse('2026-07-30T00:00:00.000Z'));
  assert.equal(summary.completed, 1);
  assert.equal(summary.reliability, 0.5);
  assert.equal(summary.streak, 1);
  assert.ok(summary.medianReturnMs > 0);
});

test('notification policy enforces active-session suppression and a two-per-day ledger', async () => {
  const rows = [];
  const db = {
    async getPlayerStore() { return rows; },
    async get(_store, id) { return rows.find((row) => row.UUID === id) || null; },
    async add(_store, record) { rows.push(record); },
  };
  const player = { UUID: 'p1' };
  const suppressed = await notifications.decideNotification(db, player, {
    type: notifications.NOTIFICATION_CATEGORY.plannedOpportunity,
    targetUUID: 't1',
    specificAction: 'Write outline',
  }, { activeSession: true, now: new Date('2026-07-27T10:00:00.000Z') });
  assert.equal(suppressed.decision, 'suppress');
  assert.ok(suppressed.reasonCodes.includes('meaningful-session-active'));

  for (const targetUUID of ['t2', 't3']) {
    const delivered = await notifications.decideNotification(db, player, {
      type: notifications.NOTIFICATION_CATEGORY.externalDeadline,
      targetUUID,
      specificAction: 'Submit form',
    }, { now: new Date('2026-07-27T11:00:00.000Z') });
    assert.equal(delivered.decision, 'deliver');
  }
  const overBudget = await notifications.decideNotification(db, player, {
    type: notifications.NOTIFICATION_CATEGORY.reentry,
    targetUUID: 't4',
    specificAction: 'Resume work',
  }, { now: new Date('2026-07-27T12:00:00.000Z') });
  assert.equal(overBudget.decision, 'suppress');
  assert.ok(overBudget.reasonCodes.includes('daily-budget-exhausted'));
});

test('Match score events are auditable, scope-gated, and reconstructable', () => {
  const match = {
    UUID: 'm1',
    rulesSnapshot: {
      eligibleTaskUUIDs: ['t1'],
      eligibleGoalUUIDs: [],
      eligibleMilestoneUUIDs: [],
    },
  };
  const event = matchScoring.createMatchScoreEvent({
    match,
    participantUUID: 'p1',
    actionSession: { UUID: 's1', targetUUID: 't1', targetType: 'todo', outcome: 'completed' },
    points: 42,
  });
  assert.equal(event.eligibleRuleId, 'task:t1');
  assert.deepEqual(matchScoring.reconstructMatchScores([event], 'm1'), { p1: 42 });
  assert.equal(matchScoring.createMatchScoreEvent({
    match,
    participantUUID: 'p1',
    actionSession: { UUID: 's2', targetUUID: 'outside' },
    points: 20,
  }), null);
});
