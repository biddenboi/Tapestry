import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const encodingSource = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encoding = await import(`data:text/javascript;base64,${Buffer.from(encodingSource).toString('base64')}`);
const contract = await import('./TaskRecommendationV12Contracts.js');

function request(tasks) {
  return contract.createTaskRecommendationV12InferenceRequest({
    requestId: 'request-1',
    playerUUID: 'player-1',
    source: 'tasks',
    decisionSeed: 'seed-1',
    now: '2026-07-11T12:00:00.000Z',
    tasks,
  });
}

test('v12 preserves required owner and lifecycle eligibility behavior', () => {
  const tasks = [
    { UUID: 'open', parent: 'player-1', name: 'Open' },
    { UUID: 'other', parent: 'player-2', name: 'Other' },
    { UUID: 'done', parent: 'player-1', status: 'completed' },
    { UUID: 'deleted', parent: 'player-1', status: 'deleted' },
    { UUID: 'blocked', parent: 'player-1', recommendationBlocked: true },
  ];
  assert.deepEqual(
    encoding.buildTaskRecommenderV12ActionSet(tasks, { playerUUID: 'player-1' })
      .map((action) => action.taskUUID)
      .filter((taskUUID, index, values) => values.indexOf(taskUUID) === index),
    ['open'],
  );
});

test('v12 contracts preserve empty and single-task recommendation outcomes', () => {
  const empty = contract.createTaskRecommendationV12InferenceResult({
    request: request([]), mode: 'empty', selected: null,
  });
  const singleRequest = request([{ UUID: 'only', parent: 'player-1', estimatedDuration: 20 }]);
  const support = encoding.buildTaskRecommenderV12ActionSet(
    singleRequest.tasks,
    { playerUUID: 'player-1' },
  );
  const action = support.find((candidate) => candidate.durationSeconds === 1200);
  const selected = contract.createTaskRecommendationV12InferenceResult({
    request: singleRequest,
    mode: 'production-v12',
    selected: {
      actionKey: action.actionKey,
      taskUUID: action.taskUUID,
      durationSeconds: action.durationSeconds,
    },
    behaviorProbability: 1,
  });
  assert.equal(empty.selected, null);
  assert.equal(selected.selected.taskUUID, 'only');
  assert.equal(selected.selected.durationSeconds, 1200);
  assert.equal(selected.mode, 'production-v12');
});

test('source, task identity, and requested duration remain explicit contracts', () => {
  const inferenceRequest = contract.createTaskRecommendationV12InferenceRequest({
    requestId: 'request-2', playerUUID: 'player-1', source: 'dojo', decisionSeed: 'seed-2',
    now: '2026-07-11T12:00:00.000Z',
    tasks: [{ UUID: 'task-1', parent: 'player-1', estimatedDuration: 25 }],
    constraints: { targetDurationSeconds: 900 },
  });
  const actions = encoding.buildTaskRecommenderV12ActionSet(inferenceRequest.tasks, {
    playerUUID: inferenceRequest.playerUUID,
    ...inferenceRequest.constraints,
  });
  const action = actions.find((candidate) => candidate.durationSeconds === 900);
  assert.equal(inferenceRequest.source, 'dojo');
  assert.equal(action.taskUUID, 'task-1');
  assert.equal(action.durationSeconds, 900);
});
