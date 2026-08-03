import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./TaskRecommender.js', import.meta.url), 'utf8');
const settings = await readFile(new URL('../../features/settings/pages/Settings/Settings.jsx', import.meta.url), 'utf8');

const exportedFunctions = [
  'buildTaskRecommenderRecommendation',
  'createTaskRecommenderWarmSession',
  'applyTaskRecommendationToTask',
  'recordTaskRecommendationImpression',
  'recordTaskRecommendationDecision',
  'recordTaskRecommendationPresentation',
  'recordTaskRecommendationVisibility',
  'invalidateTaskRecommendationDecision',
  'recordTaskRecommendationOutcome',
  'recordTaskRecommendationSessionResult',
  'dismissRecommendationForTask',
  'recordTaskRecommendationManualChoice',
  'trainTaskRecommender',
  'launchRecommendedTask',
];

test('active compatibility facade preserves task feature actions while delegating to v12', () => {
  for (const name of exportedFunctions) assert.match(source, new RegExp(`export (?:async )?function ${name}\\b`));
  assert.match(source, /inferTaskRecommendationV12/);
  assert.match(source, /trainTaskRecommendationV12/);
  assert.match(source, /appendTaskRecommenderProtocolEvents/);
  assert.match(source, /assertTaskRecommenderV12RuntimeReady/);
  assert.match(source, /TASK_RECOMMENDER_ACTIVE_RUNTIME = 'v12'/);
});

test('active facade contains no planning authority, v11 model, weight editing, or runtime fallback', () => {
  assert.doesNotMatch(source, /buildPlanningCandidates|buildWorkloadModel|planningScore|TaskRecommenderModel|TaskRecommenderState|taskRecommenderWeights|fallback.*v11|v11.*fallback/i);
  assert.doesNotMatch(settings, /taskRecommenderWeights|Weight Editor|Synthetic Weights|Proxy Head|v11/i);
});

test('recommendation outcomes are v12 protocol facts and completion processing is idempotent', () => {
  assert.match(source, /TASK_RECOMMENDER_EVENT_TYPES\.taskSessionFinished/);
  assert.match(source, /TASK_RECOMMENDER_EVENT_TYPES\.taskRecordedComplete/);
  assert.match(source, /entry\?\.completionEventUUID === completionEventUUID/);
  assert.match(source, /productiveSeconds/);
  assert.match(source, /completionEventUUID/);
  assert.match(source, /sessionFinishedAt/);
  assert.match(source, /observationSessionUUID/);
});

test('public task objects do not expose private policy diagnostics', () => {
  const publicStart = source.indexOf('function publicRecommendation');
  const publicEnd = source.indexOf('\n}\n\nexport async function buildTaskRecommenderRecommendation', publicStart);
  const publicSource = source.slice(publicStart, publicEnd);
  const publicObject = publicSource.slice(0, publicSource.indexOf('privateRecommendationState.set'));
  assert.match(publicSource, /privateRecommendationState\.set/);
  assert.doesNotMatch(publicObject, /diagnostics\s*:/);
  assert.doesNotMatch(publicObject, /policyDecision\s*:/);
  assert.doesNotMatch(publicObject, /acceptanceProbability\s*:/);
  assert.doesNotMatch(publicObject, /confidence\s*:/);
  assert.match(publicObject, /evidenceState/);
});
