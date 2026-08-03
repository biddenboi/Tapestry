import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TASK_RECOMMENDER_V12_REPRESENTATION_PHASES,
  normalizeTaskRecommenderV12RepresentationTrainingState,
  selectTaskRecommenderV12RepresentationPhase,
  taskRecommenderV12TrainableLayerMask,
} from './TaskRecommenderV12RepresentationTraining.js';

const fullEvidence = {
  resolvedDecisions: 1_000,
  activeDays: 100,
  returnCycles: 100,
  exactPropensityCoverage: 1,
};

test('progressive representation phases expose explicit cumulative layer masks', () => {
  assert.deepEqual(TASK_RECOMMENDER_V12_REPRESENTATION_PHASES, [
    'head-only', 'representation', 'interaction', 'recurrent',
  ]);
  assert.deepEqual(taskRecommenderV12TrainableLayerMask('head-only'), {
    representationLayer: false,
    interactionLayer: false,
    recurrentValue: false,
    taskEncoderAuxiliary: false,
    recurrentEncoderAuxiliary: false,
  });
  assert.equal(taskRecommenderV12TrainableLayerMask('representation').representationLayer, true);
  assert.equal(taskRecommenderV12TrainableLayerMask('representation').interactionLayer, false);
  assert.equal(taskRecommenderV12TrainableLayerMask('interaction').interactionLayer, true);
  assert.equal(taskRecommenderV12TrainableLayerMask('interaction').recurrentValue, false);
  assert.equal(taskRecommenderV12TrainableLayerMask('recurrent').recurrentValue, true);
  assert.equal(
    taskRecommenderV12TrainableLayerMask('recurrent').recurrentEncoderAuxiliary,
    true,
  );
});

test('even fully mature evidence advances only one representation phase per promotion', () => {
  const first = selectTaskRecommenderV12RepresentationPhase(null, fullEvidence);
  assert.equal(first.previousState.phase, 'head-only');
  assert.equal(first.attemptPhase, 'representation');
  assert.equal(first.phaseAdvanced, true);
  const second = selectTaskRecommenderV12RepresentationPhase(
    { phase: 'representation' },
    fullEvidence,
  );
  assert.equal(second.attemptPhase, 'interaction');
  const third = selectTaskRecommenderV12RepresentationPhase(
    { phase: 'interaction' },
    fullEvidence,
  );
  assert.equal(third.attemptPhase, 'recurrent');
});

test('low evidence remains head-only and malformed optimizer moments fail closed', () => {
  const selected = selectTaskRecommenderV12RepresentationPhase(null, {
    resolvedDecisions: 20,
    activeDays: 2,
    returnCycles: 1,
    exactPropensityCoverage: 0.2,
  });
  assert.equal(selected.attemptPhase, 'head-only');
  const normalized = normalizeTaskRecommenderV12RepresentationTrainingState({
    phase: 'representation',
    optimizerState: {
      algorithm: 'adam-trust-region-v1',
      step: 9,
      moments: {
        invalid: { m: [1, Number.NaN], v: [1, 2] },
        mismatched: { m: [1], v: [1, 2] },
        valid: { m: [0.1], v: [0.2] },
      },
    },
  });
  assert.equal(normalized.phase, 'representation');
  assert.equal(normalized.optimizerState.step, 9);
  assert.deepEqual(Object.keys(normalized.optimizerState.moments), ['valid']);
});
