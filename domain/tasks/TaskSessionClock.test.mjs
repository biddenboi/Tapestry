import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTaskSessionSnapshot,
  pauseTaskSession,
  resumeTaskSession,
  taskSessionElapsed,
} from './TaskSessionClock.js';

test('task-session elapsed time survives minimize/expand presentation changes', () => {
  const session = {
    startedAtMs: 1_000,
    committedMs: 10_000,
    pausedAtMs: null,
    pausedTotalMs: 0,
    mode: 'expanded',
  };
  assert.equal(taskSessionElapsed(session, 5_000), 4_000);
  assert.equal(taskSessionElapsed({ ...session, mode: 'docked' }, 8_000), 7_000);
});

test('pause and resume cycles exclude every paused interval exactly once', () => {
  const firstPause = pauseTaskSession({
    startedAtMs: 1_000,
    pausedAtMs: null,
    pausedTotalMs: 0,
  }, 4_000);
  assert.equal(taskSessionElapsed(firstPause, 9_000), 3_000);

  const firstResume = resumeTaskSession(firstPause, 7_000);
  assert.equal(taskSessionElapsed(firstResume, 10_000), 6_000);

  const secondPause = pauseTaskSession(firstResume, 12_000);
  const secondResume = resumeTaskSession(secondPause, 14_500);
  assert.equal(taskSessionElapsed(secondResume, 20_000), 13_500);
});

test('one snapshot drives remaining time, progress, and overtime in either view', () => {
  const base = {
    startedAtMs: 1_000,
    committedMs: 5_000,
    pausedAtMs: null,
    pausedTotalMs: 0,
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(buildTaskSessionSnapshot(base, 4_000))
      .filter(([key]) => ['elapsedMs', 'commitmentMet', 'progressRatio', 'timerDisplayMs', 'timerModeLabel'].includes(key))),
    {
      elapsedMs: 3_000,
      commitmentMet: false,
      progressRatio: 0.6,
      timerDisplayMs: 2_000,
      timerModeLabel: 'Time remaining',
    },
  );
  const overtime = buildTaskSessionSnapshot({ ...base, mode: 'docked' }, 8_000);
  assert.equal(overtime.commitmentMet, true);
  assert.equal(overtime.timerDisplayMs, 7_000);
  assert.equal(overtime.timerModeLabel, 'Overtime');
});
