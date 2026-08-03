import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGoalProgress,
  buildLearningProgress,
  buildMetricProgress,
  buildMilestoneProgress,
} from './GoalProgress.js';

test('milestone progress excludes skipped stages and handles zero milestones', () => {
  const progress = buildMilestoneProgress([
    { UUID: 'a', position: 0, status: 'completed' },
    { UUID: 'b', position: 1, status: 'skipped' },
    { UUID: 'c', position: 2, status: 'active' },
  ]);
  assert.equal(progress.completed, 1);
  assert.equal(progress.total, 2);
  assert.equal(progress.currentMilestone.UUID, 'c');
  assert.deepEqual(buildMilestoneProgress([]), {
    type: 'milestones',
    completed: 0,
    total: 0,
    currentMilestone: null,
  });
});

test('metric progress supports increasing, decreasing, and zero-span targets', () => {
  assert.equal(buildMetricProgress({ startValue: 0, currentValue: 40, targetValue: 100 }).ratio, 0.4);
  assert.equal(buildMetricProgress({ startValue: 100, currentValue: 70, targetValue: 40 }).ratio, 0.5);
  assert.equal(buildMetricProgress({ startValue: 10, currentValue: 10, targetValue: 10 }).ratio, 1);
  assert.equal(buildMetricProgress({ startValue: 10, currentValue: 9, targetValue: 10 }).ratio, 0);
});

test('learning progress reports demonstrated stages separately', () => {
  const progress = buildLearningProgress([
    { UUID: 'a', kind: 'learning_stage', position: 0, status: 'completed' },
    { UUID: 'b', kind: 'learning_stage', position: 1, status: 'active' },
  ]);
  assert.equal(progress.type, 'learning');
  assert.equal(progress.completedStages, 1);
  assert.equal(progress.totalStages, 2);
  assert.equal(progress.currentStage.UUID, 'b');
  assert.equal(buildGoalProgress({ progressType: 'learning' }, []).type, 'learning');
});
