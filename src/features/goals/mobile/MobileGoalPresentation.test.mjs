import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileGoalDetailFacts,
  mobileGoalProgressLabel,
  selectMobileGoalCards,
} from './MobileGoalPresentation.js';

test('ordinary mobile Goals contain active and blocked records but never completed records', () => {
  const selected = selectMobileGoalCards({
    activeGoals: [
      { goalUUID: 'active', lifecycleStatus: 'active', healthStatus: 'on_track' },
      { goalUUID: 'blocked', lifecycleStatus: 'active', healthStatus: 'blocked' },
      { goalUUID: 'completed-leak', lifecycleStatus: 'completed', healthStatus: 'on_track' },
    ],
    completedGoals: [{ goalUUID: 'completed' }],
  });
  assert.deepEqual(selected.cards.map((card) => card.goalUUID), ['blocked', 'active']);
  assert.deepEqual(selected.blocked.map((card) => card.goalUUID), ['blocked']);
  assert.deepEqual(selected.active.map((card) => card.goalUUID), ['active']);
  assert.deepEqual(selectMobileGoalCards(null).cards, []);
});

test('mobile Goal detail derives the required next state without exposing schema editing', () => {
  const facts = buildMobileGoalDetailFacts({
    goal: {
      finishCondition: 'Ship the release.',
      blockedReason: 'Waiting for review.',
    },
    milestones: [
      { UUID: 'done', status: 'completed', title: 'Draft' },
      { UUID: 'next', status: 'active', title: 'Review' },
    ],
    linkedWork: [{ entityType: 'todo', UUID: 'todo-1', name: 'Send review package' }],
  });
  assert.equal(facts.finishCondition, 'Ship the release.');
  assert.equal(facts.blocker, 'Waiting for review.');
  assert.equal(facts.nextMilestone.UUID, 'next');
  assert.equal(facts.nextAction, 'Send review package');
  assert.equal(mobileGoalProgressLabel({ percent: 63.6 }), '64%');
});
