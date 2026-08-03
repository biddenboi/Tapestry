import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGoalAttention } from './GoalAttention.js';

const NOW = new Date('2026-07-27T12:00:00.000Z');

function goal(overrides = {}) {
  return {
    UUID: 'goal-1',
    name: 'Ship release',
    finishCondition: 'Release is published and verified.',
    lifecycleStatus: 'active',
    healthStatus: 'on_track',
    nextAction: { entityUUID: 'todo-1' },
    createdAt: '2026-07-01T12:00:00.000Z',
    lastReviewedAt: '2026-07-26T12:00:00.000Z',
    reviewIntervalDays: 7,
    ...overrides,
  };
}

test('attention notices follow factual priority order', () => {
  const notices = buildGoalAttention(goal({
    healthStatus: 'blocked',
    blockedReason: 'waiting on review',
    finishCondition: '',
    nextAction: null,
    targetDate: '2026-07-20',
    lastReviewedAt: '2026-07-01T12:00:00.000Z',
  }), { now: NOW, lastLinkedActivityAt: '2026-07-01T12:00:00.000Z' });
  assert.deepEqual(notices.slice(0, 4).map((entry) => entry.type), [
    'blocked',
    'target_date_passed',
    'no_finish_condition',
    'no_next_action',
  ]);
  assert.ok(notices.every((entry) => !/neglect|fail|lazy|behind/i.test(entry.message)));
});

test('target and inactivity boundaries are deterministic', () => {
  assert.ok(buildGoalAttention(goal({ targetDate: '2026-08-03' }), { now: NOW })
    .some((entry) => entry.type === 'target_within_7_days'));
  assert.ok(buildGoalAttention(goal(), {
    now: NOW,
    lastLinkedActivityAt: '2026-07-13T11:59:59.000Z',
  }).some((entry) => entry.type === 'no_linked_activity_14_days'));
  assert.ok(!buildGoalAttention(goal(), {
    now: NOW,
    lastLinkedActivityAt: '2026-07-14T12:00:01.000Z',
  }).some((entry) => entry.type === 'no_linked_activity_14_days'));
});

test('review due uses the configured interval', () => {
  assert.ok(buildGoalAttention(goal({ lastReviewedAt: '2026-07-20T12:00:00.000Z' }), { now: NOW })
    .some((entry) => entry.type === 'review_due'));
  assert.ok(!buildGoalAttention(goal({ lastReviewedAt: '2026-07-21T12:00:01.000Z' }), { now: NOW })
    .some((entry) => entry.type === 'review_due'));
});
