import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mathSource = await readFile(new URL('./TaskRecommenderV12Math.js', import.meta.url), 'utf8');
const mathUrl = `data:text/javascript;base64,${Buffer.from(mathSource).toString('base64')}`;
const math = await import(mathUrl);

const modelSourceRaw = await readFile(new URL('./TaskRecommenderV12Model.js', import.meta.url), 'utf8');
const modelSource = modelSourceRaw.replace("from './TaskRecommenderV12Math.js';", `from '${mathUrl}';`);
const model = await import(`data:text/javascript;base64,${Buffer.from(modelSource).toString('base64')}`);

const encodingSource = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encoding = await import(`data:text/javascript;base64,${Buffer.from(encodingSource).toString('base64')}`);

function makeEncodedAction(task, durationSeconds = 1200) {
  const snapshot = encoding.createTaskRecommenderV12TaskSnapshot(task);
  return encoding.encodeTaskRecommenderV12Action({
    actionKey: `${snapshot.UUID}:${durationSeconds}`,
    taskUUID: snapshot.UUID,
    durationSeconds,
    taskSnapshot: snapshot,
  }, {
    now: '2026-07-11T12:00:00.000Z',
    source: 'dojo',
  });
}

test('v12 model is deterministic, compact, and within the production parameter budget', () => {
  const first = model.createTaskRecommenderV12Model({ seed: 'same-seed' });
  const second = model.createTaskRecommenderV12Model({ seed: 'same-seed' });
  const different = model.createTaskRecommenderV12Model({ seed: 'different-seed' });
  assert.deepEqual(first.gru.inputUpdate, second.gru.inputUpdate);
  assert.notDeepEqual(first.gru.inputUpdate, different.gru.inputUpdate);
  assert.ok(model.countTaskRecommenderV12Parameters(first) < 150_000);
  assert.equal(first.dimensions.state, 48);
  assert.equal(first.dimensions.representation, 32);
});

test('streaming GRU is finite, stateful, and order-sensitive', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'sequence' });
  const presented = {
    type: 'recommendation_presented',
    taskUUID: 'task-1',
    source: 'dojo',
    occurredAt: '2026-07-11T12:00:00.000Z',
    payload: { visibleMs: 1500 },
  };
  const finished = {
    type: 'task_session_finished',
    taskUUID: 'task-1',
    source: 'dojo',
    occurredAt: '2026-07-11T12:20:00.000Z',
    payload: { productiveSeconds: 1080, committedSeconds: 1200 },
  };
  const forward = model.replayTaskRecommenderV12Events(valueModel, [presented, finished]);
  const reverse = model.replayTaskRecommenderV12Events(valueModel, [finished, presented]);
  assert.equal(forward.length, 48);
  assert.ok(forward.every(Number.isFinite));
  assert.notDeepEqual(forward, reverse);
  assert.ok(forward.some((value) => Math.abs(value) > 1e-8));
});

test('neutral Bayesian value begins at zero and learns while reducing local uncertainty', () => {
  const posterior = model.createTaskRecommenderV12BayesianPosterior({
    width: 32,
    priorPrecision: 1,
    observationVariance: 1,
  });
  const observed = Array(32).fill(0);
  observed[0] = 1;
  const unobserved = Array(32).fill(0);
  unobserved[1] = 1;
  const before = model.predictTaskRecommenderV12Posterior(posterior, observed);
  assert.equal(before.mean, 0);
  for (let index = 0; index < 8; index += 1) {
    model.updateTaskRecommenderV12Posterior(posterior, observed, 2);
  }
  const after = model.predictTaskRecommenderV12Posterior(posterior, observed);
  const elsewhere = model.predictTaskRecommenderV12Posterior(posterior, unobserved);
  assert.ok(after.mean > 1.7 && after.mean < 2);
  assert.ok(after.epistemicVariance < before.epistemicVariance);
  assert.ok(elsewhere.epistemicVariance > after.epistemicVariance * 5);
  assert.equal(posterior.updateCount, 8);
});

test('posterior samples are deterministic under a seed and vary under uncertainty', () => {
  const posterior = model.createTaskRecommenderV12BayesianPosterior({ width: 32 });
  const first = model.sampleTaskRecommenderV12PosteriorWeights(
    posterior,
    math.createSeededRandom('posterior-sample'),
  );
  const second = model.sampleTaskRecommenderV12PosteriorWeights(
    posterior,
    math.createSeededRandom('posterior-sample'),
  );
  assert.deepEqual(first, second);
  assert.ok(first.every(Number.isFinite));
  assert.ok(first.some((value) => Math.abs(value) > 0.01));
});

test('state-action representation scores full task-duration sets locally', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'full-actions' });
  const state = model.replayTaskRecommenderV12Events(valueModel, [{
    type: 'recommendation_presented',
    taskUUID: 'task-0',
    occurredAt: '2026-07-11T11:00:00.000Z',
    payload: {},
  }]);
  const tasks = Array.from({ length: 20 }, (_, index) => ({
    UUID: `task-${index}`,
    name: index % 2 ? `Draft section ${index}` : `- Plan ${index}\n- Execute ${index}`,
    estimatedDuration: 10 + index,
    dueDate: `2026-07-${String(12 + index % 10).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const actions = encoding.buildTaskRecommenderV12ActionSet(tasks, {
    minDurationSeconds: 300,
    maxDurationSeconds: 3600,
  });
  const predictions = actions.map((action) => model.predictTaskRecommenderV12Action(
    valueModel,
    state,
    encoding.encodeTaskRecommenderV12Action(action, {
      now: '2026-07-11T12:00:00.000Z',
      source: 'match',
    }),
  ));
  assert.equal(predictions.length, actions.length);
  assert.ok(predictions.every((prediction) => (
    prediction.representation.length === 32
    && Number.isFinite(prediction.mean)
    && Number.isFinite(prediction.epistemicVariance)
    && prediction.epistemicVariance >= 0
  )));
  assert.ok(predictions.every((prediction) => prediction.mean === 0));
  assert.ok(predictions.every((prediction) => prediction.safetyMean === 0));
});

test('long-horizon and immediate safety posteriors learn independently', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'dual-heads' });
  const state = Array(valueModel.dimensions.state).fill(0);
  const action = makeEncodedAction({ UUID: 'task-dual', name: 'Dual-head task' }, 900);
  const initial = model.predictTaskRecommenderV12Action(valueModel, state, action);
  model.updateTaskRecommenderV12Posterior(
    valueModel.safetyPosterior,
    initial.representation,
    0.5,
  );
  const safetyOnly = model.predictTaskRecommenderV12Action(valueModel, state, action);
  assert.equal(safetyOnly.mean, 0);
  assert.ok(safetyOnly.safetyMean > 0);
  model.updateTaskRecommenderV12Posterior(
    valueModel.posterior,
    initial.representation,
    2,
  );
  const both = model.predictTaskRecommenderV12Action(valueModel, state, action);
  assert.ok(both.mean > safetyOnly.mean);
  assert.equal(both.safetyMean, safetyOnly.safetyMean);
});

test('checkpoint round-trip preserves state-action predictions exactly', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'checkpoint' });
  const state = Array(48).fill(0).map((_, index) => Math.sin(index) * 0.1);
  const action = makeEncodedAction({
    UUID: 'task-checkpoint',
    name: 'Draft implementation notes',
    description: '- Review schema\n- Write tests',
    estimatedDuration: 35,
    dueDate: '2026-07-13T12:00:00.000Z',
  }, 1800);
  const initial = model.predictTaskRecommenderV12Action(valueModel, state, action);
  model.updateTaskRecommenderV12Posterior(valueModel.posterior, initial.representation, 1.25);
  const before = model.predictTaskRecommenderV12Action(valueModel, state, action);
  const checkpoint = model.serializeTaskRecommenderV12Model(valueModel);
  const restored = model.restoreTaskRecommenderV12Model(checkpoint);
  const after = model.predictTaskRecommenderV12Action(restored, state, action);
  assert.deepEqual(after, before);
  assert.notEqual(restored, valueModel);
});

test('invalid tensors and checkpoints fail closed', () => {
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'invalid' });
  const action = makeEncodedAction({ UUID: 'task-invalid', name: 'Invalid test' });
  assert.throws(() => model.taskRecommenderV12Representation(valueModel, [0], action), /state shape/);
  const checkpoint = model.serializeTaskRecommenderV12Model(valueModel);
  checkpoint.gru.inputUpdate[0] = Number.NaN;
  assert.throws(() => model.restoreTaskRecommenderV12Model(checkpoint), /invalid parameters/);
});

test('model source contains no authored behavioral state vocabulary', () => {
  for (const forbidden of [
    'deadlinePressure', 'durationFit', 'workReadiness', 'fatigue', 'momentum',
    'continuation', 'strategyCapture', 'quickStart',
  ]) {
    assert.doesNotMatch(modelSourceRaw, new RegExp(forbidden));
  }
});
