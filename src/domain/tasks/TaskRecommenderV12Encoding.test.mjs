import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encoding = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('v12 emits bounded numerical duration support for every eligible task', () => {
  const tasks = Array.from({ length: 20 }, (_, index) => ({
    UUID: `task-${index}`,
    parent: 'player-1',
    name: `Task ${index}`,
    estimatedDuration: 10 + index,
  }));
  const actions = encoding.buildTaskRecommenderV12ActionSet(tasks, { playerUUID: 'player-1' });
  assert.ok(actions.length >= tasks.length * 5);
  assert.ok(actions.length <= tasks.length * 7);
  assert.equal(new Set(actions.map((action) => action.taskUUID)).size, tasks.length);
  assert.equal(encoding.TASK_RECOMMENDER_V12_DEFAULT_DURATION_POINT_COUNT, 5);
});

test('duration support is deterministic log quadrature with estimate and request anchors', () => {
  const support = encoding.buildTaskRecommenderV12DurationSupport(
    { UUID: 'task-1', estimatedDuration: 37 },
    { minDurationSeconds: 300, maxDurationSeconds: 7200, durationQuantumSeconds: 60 },
  );
  assert.deepEqual(support, [300, 660, 1440, 2220, 3240, 7200]);
  const requested = encoding.buildTaskRecommenderV12DurationSupport(
    { UUID: 'task-1', estimatedDuration: 37 },
    { targetDurationSeconds: 901, minDurationSeconds: 300, maxDurationSeconds: 7200, durationQuantumSeconds: 60 },
  );
  assert.ok(requested.includes(900));
  assert.ok(requested.includes(2220));
});

test('workspace tasks remain eligible across profiles before v12 action creation', () => {
  const actions = encoding.buildTaskRecommenderV12ActionSet([
    { UUID: 'open', parent: 'player-1', estimatedDuration: 15 },
    { UUID: 'other-owner', parent: 'player-2', estimatedDuration: 15 },
    { UUID: 'done', parent: 'player-1', status: 'completed', estimatedDuration: 15 },
    { UUID: 'blocked', parent: 'player-1', doNotSuggest: true, estimatedDuration: 15 },
  ], { playerUUID: 'player-1' });
  assert.deepEqual([...new Set(actions.map((action) => action.taskUUID))], ['open', 'other-owner']);
});

test('deadline remains a raw signed time input without planning authority', () => {
  const snapshot = encoding.createTaskRecommenderV12TaskSnapshot({
    UUID: 'task-1', parent: 'player-1', dueDate: '2026-07-12T12:00:00.000Z', estimatedDuration: 20,
  });
  const encoded = encoding.encodeTaskRecommenderV12Action({
    actionKey: 'task-1:1200', taskUUID: 'task-1', durationSeconds: 1200, taskSnapshot: snapshot,
  }, { now: '2026-07-11T12:00:00.000Z', source: 'tasks' });
  assert.equal(encoded.raw.dueDeltaSeconds, 86400);
  assert.equal('planningScore' in encoded.raw, false);
  assert.equal(encoded.numeric.length, encoding.TASK_RECOMMENDER_V12_NUMERIC_WIDTH);
  assert.equal(encoded.categorical.length, encoding.TASK_RECOMMENDER_V12_CATEGORICAL_HASH_WIDTH);
});

test('exposure inputs are derived only from prior raw protocol events', () => {
  const exposure = encoding.buildTaskRecommenderV12TaskExposure([
    { type: 'recommendation_presented', taskUUID: 'task-1', occurredAt: '2026-07-11T10:00:00Z' },
    { type: 'recommendation_skipped', taskUUID: 'task-1', occurredAt: '2026-07-11T10:01:00Z' },
    {
      type: 'task_session_finished', taskUUID: 'task-1', occurredAt: '2026-07-11T10:02:00Z',
      payload: { sessionTimingSchemaVersion: 1 },
    },
    { type: 'recommendation_presented', taskUUID: 'task-1', occurredAt: '2026-07-11T12:00:00Z' },
  ], '2026-07-11T11:00:00Z');
  assert.deepEqual(exposure['task-1'], {
    presentationCount: 1,
    skipCount: 1,
    verifiedSessionCount: 1,
    lastPresentationTimestampMs: Date.parse('2026-07-11T10:00:00Z'),
  });
});

test('deadline, surface, and project channels remain independently ablatable raw inputs', () => {
  const baseTask = {
    UUID: 'task-1', parent: 'player-1', name: 'Draft', projectId: 'project-a',
    dueDate: '2026-07-12T12:00:00Z', estimatedDuration: 20,
  };
  const action = encoding.buildTaskRecommenderV12ActionSet([baseTask], {
    minDurationSeconds: 1200, maxDurationSeconds: 1200,
  })[0];
  const base = encoding.encodeTaskRecommenderV12Action(action, {
    now: '2026-07-11T12:00:00Z', source: 'tasks', queueSize: 1,
  });
  const later = encoding.encodeTaskRecommenderV12Action(action, {
    now: '2026-07-11T18:00:00Z', source: 'tasks', queueSize: 1,
  });
  const dojo = encoding.encodeTaskRecommenderV12Action(action, {
    now: '2026-07-11T12:00:00Z', source: 'dojo', queueSize: 1,
  });
  const otherProjectAction = encoding.buildTaskRecommenderV12ActionSet([
    { ...baseTask, projectId: 'project-b' },
  ], { minDurationSeconds: 1200, maxDurationSeconds: 1200 })[0];
  const otherProject = encoding.encodeTaskRecommenderV12Action(otherProjectAction, {
    now: '2026-07-11T12:00:00Z', source: 'tasks', queueSize: 1,
  });
  assert.notEqual(base.raw.dueDeltaSeconds, later.raw.dueDeltaSeconds);
  assert.notDeepEqual(base.categorical, dojo.categorical);
  assert.notDeepEqual(base.categorical, otherProject.categorical);
});

test('text form is local, bounded, and deterministic rather than a semantic category', () => {
  const task = { UUID: 'task-1', name: 'Write the launch notes', description: '- Verify copy\n- Publish' };
  const first = encoding.hashTaskText(task);
  const second = encoding.hashTaskText(task);
  assert.deepEqual(first, second);
  assert.equal(first.length, encoding.TASK_RECOMMENDER_V12_TEXT_HASH_WIDTH);
  assert.ok(first.every(Number.isFinite));
  assert.ok(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0)) <= 1.0000001);
});
