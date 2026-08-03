import assert from 'node:assert/strict';
import test from 'node:test';
import {
  repairLegacyMatchSessionAnchor,
  taskSessionRequestedAt,
  taskSessionRequestKey,
} from './TaskSessionLaunch.js';

test('task creation time never requests or anchors a task session', () => {
  const task = {
    UUID: 'task-1',
    createdAt: '2026-07-27T00:00:00.000Z',
  };
  assert.equal(taskSessionRequestKey(task), null);
  assert.equal(
    taskSessionRequestedAt(task, Date.parse('2026-07-28T00:00:00.000Z')),
    '2026-07-28T00:00:00.000Z',
  );
});

test('an explicit start request and a durable session each produce stable keys', () => {
  assert.equal(taskSessionRequestKey({
    UUID: 'task-1',
    sessionRequestedAt: '2026-07-28T01:02:03.000Z',
  }), 'task-1:2026-07-28T01:02:03.000Z');
  assert.equal(taskSessionRequestKey({
    UUID: 'task-1',
    actionSessionUUID: 'session-1',
  }), 'session-1');
});

test('legacy Match sessions accidentally anchored to task creation repair once on restore', () => {
  const record = {
    UUID: 'session-1',
    outcome: 'active',
    source: 'match',
    startedAt: '2026-07-27T00:00:00.000Z',
    activeAnchorAt: '2026-07-27T00:00:00.000Z',
    activeDurationMs: 0,
    pausedDurationMs: 0,
    pausedAt: null,
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
  const todo = { UUID: 'task-1', createdAt: '2026-07-27T00:00:00.000Z' };
  const repaired = repairLegacyMatchSessionAnchor(
    record,
    todo,
    Date.parse('2026-07-28T00:00:00.000Z'),
  );
  assert.notEqual(repaired, record);
  assert.equal(repaired.startedAt, '2026-07-28T00:00:00.000Z');
  assert.equal(repaired.activeAnchorAt, '2026-07-28T00:00:00.000Z');
  assert.equal(repaired.updatedAt, '2026-07-28T00:00:00.000Z');

  const manualRecord = { ...record, source: 'manual' };
  assert.equal(repairLegacyMatchSessionAnchor(
    manualRecord,
    todo,
    Date.parse('2026-07-28T00:00:00.000Z'),
  ), manualRecord);
  assert.equal(repairLegacyMatchSessionAnchor(
    record,
    { ...todo, createdAt: '2026-07-27T03:00:00.000Z' },
    Date.parse('2026-07-28T00:00:00.000Z'),
  ), record);
});
