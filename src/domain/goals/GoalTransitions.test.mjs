import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGoalTransition, canTransitionGoal } from './GoalTransitions.js';

const base = {
  UUID: 'goal-1',
  parent: 'player-1',
  lifecycleStatus: 'active',
  status: 'active',
  healthStatus: 'on_track',
  finishCondition: 'The release is live.',
};

test('goal lifecycle allows only explicit transitions', () => {
  assert.equal(canTransitionGoal('active', 'paused'), true);
  assert.equal(canTransitionGoal('paused', 'archived'), true);
  assert.equal(canTransitionGoal('archived', 'completed'), false);
  assert.throws(() => buildGoalTransition(base, 'active'), /cannot transition/);
});

test('completion requires finish confirmation and archive does not award', () => {
  assert.throws(
    () => buildGoalTransition(base, 'completed'),
    (error) => error.code === 'goal-finish-confirmation-required',
  );
  const completed = buildGoalTransition(base, 'completed', {
    finishConfirmed: true,
    now: '2026-07-27T12:00:00.000Z',
  });
  assert.equal(completed.shouldAwardCompletion, true);
  assert.equal(completed.goal.completedAt, '2026-07-27T12:00:00.000Z');
  const archived = buildGoalTransition(base, 'archived');
  assert.equal(archived.shouldAwardCompletion, false);
});

test('reopening preserves historical completion evidence', () => {
  const completed = { ...base, lifecycleStatus: 'completed', status: 'completed', completedAt: '2026-07-20T12:00:00.000Z' };
  const reopened = buildGoalTransition(completed, 'active');
  assert.equal(reopened.goal.lifecycleStatus, 'active');
  assert.equal(reopened.goal.completedAt, null);
  assert.match(reopened.update.summary, /completed to active/);
});
