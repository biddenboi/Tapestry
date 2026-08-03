import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const replaceImport = (source, specifier, url) => source.replace(`from '${specifier}';`, `from '${url}';`);

const mathSource = await readFile(new URL('./TaskRecommenderV12Math.js', import.meta.url), 'utf8');
const mathUrl = dataUrl(mathSource);
const encodingSource = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encodingUrl = dataUrl(encodingSource);
let candidateEvidenceSource = await readFile(
  new URL('./TaskRecommenderV12CandidateEvidence.js', import.meta.url),
  'utf8',
);
candidateEvidenceSource = candidateEvidenceSource
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings' };")
  .replace("from './TaskRecommenderV12Encoding.js';", `from '${encodingUrl}';`);
const candidateEvidenceUrl = dataUrl(candidateEvidenceSource);
const modelSource = replaceImport(
  await readFile(new URL('./TaskRecommenderV12Model.js', import.meta.url), 'utf8'),
  './TaskRecommenderV12Math.js',
  mathUrl,
);
const modelUrl = dataUrl(modelSource);
const model = await import(modelUrl);
let policySource = await readFile(new URL('./TaskRecommenderV12Policy.js', import.meta.url), 'utf8');
policySource = replaceImport(policySource, './TaskRecommenderV12Encoding.js', encodingUrl);
policySource = replaceImport(policySource, './TaskRecommenderV12Model.js', modelUrl);
policySource = replaceImport(policySource, './TaskRecommenderV12Math.js', mathUrl);
const policyUrl = dataUrl(policySource);
const stateUrl = dataUrl(`
  export async function getTaskRecommenderV12PolicyState() {
    return { state: { budget: { remaining: 1, total: 1 } } };
  }
`);
const trainingUrl = dataUrl('export async function getTaskRecommenderV12Checkpoint() { return globalThis.__servingCheckpoint; }');
const ledgerUrl = dataUrl('export async function getTaskRecommenderProtocolEvents() { return globalThis.__servingEvents || []; }');
const registryUrl = dataUrl(`
  export async function resolveTaskRecommenderV12ServingPolicy(db, playerUUID, checkpoint) {
    return {
      checkpoint,
      policyManifest: null,
      assignment: { runtime: 'v12', policyUUID: 'current-test', assignmentProbability: 1 },
    };
  }
`);
let servingSource = await readFile(new URL('./TaskRecommenderV12Serving.js', import.meta.url), 'utf8');
for (const [specifier, url] of [
  ['./TaskRecommenderV12Encoding.js', encodingUrl],
  ['./TaskRecommenderV12CandidateEvidence.js', candidateEvidenceUrl],
  ['./TaskRecommenderV12Model.js', modelUrl],
  ['./TaskRecommenderV12Policy.js', policyUrl],
  ['./TaskRecommenderV12PolicyState.js', stateUrl],
  ['./TaskRecommenderV12Training.js', trainingUrl],
  ['./TaskRecommenderLedger.js', ledgerUrl],
  ['./TaskRecommenderV12PolicyRegistry.js', registryUrl],
]) servingSource = replaceImport(servingSource, specifier, url);
const serving = await import(dataUrl(servingSource));

globalThis.__servingCheckpoint = (() => {
  const value = model.createTaskRecommenderV12Model({ seed: 'serving-test' });
  return { model: value, targetModel: structuredClone(value), manifest: { status: 'promoted' } };
})();
globalThis.__servingEvents = [];

const db = {};
const tasks = [
  { UUID: 'task-a', parent: 'player-1', name: 'Draft section', estimatedDuration: 25 },
  { UUID: 'task-b', parent: 'player-1', name: 'Review notes', estimatedDuration: 15 },
];

test('v12 is the only serving mode and scores bounded task-duration support locally', async () => {
  const result = await serving.evaluateTaskRecommenderV12({
    databaseConnection: db,
    currentPlayer: { UUID: 'player-1' },
    todos: tasks,
    source: 'dojo',
    now: new Date('2026-07-11T12:00:00.000Z'),
    decisionSeed: 'decision-1',
  });
  assert.equal(result.mode, 'production-v12');
  assert.equal(result.shouldServeV12, true);
  assert.ok(result.device.actionCount >= 10 && result.device.actionCount <= 14);
  assert.equal(result.candidateEvidence.manifest.actionCount, result.device.actionCount);
  assert.equal(result.candidateEvidence.manifest.taskCount, 2);
  assert.ok(tasks.some((task) => task.UUID === result.recommendation.taskUUID));
  assert.ok(result.recommendation.durationSeconds > 0);
  assert.ok(result.policyDecision.selected.jointBehaviorProbability > 0);
});

test('serving applies lifecycle eligibility before inference and returns null for no actions', async () => {
  const result = await serving.evaluateTaskRecommenderV12({
    databaseConnection: db,
    currentPlayer: { UUID: 'player-1' },
    todos: [
      { UUID: 'done', parent: 'player-1', status: 'completed', estimatedDuration: 15 },
      { UUID: 'blocked', parent: 'player-2', recommendationBlocked: true, estimatedDuration: 15 },
    ],
    source: 'tasks',
    now: new Date('2026-07-11T12:00:00.000Z'),
    decisionSeed: 'decision-empty',
  });
  assert.equal(result, null);
});

test('serving module has no v11 comparator, shadow assignment, or runtime fallback', async () => {
  const source = await readFile(new URL('./TaskRecommenderV12Serving.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /v11|championRecommendation|shadow|experiment|fallback/i);
  assert.match(source, /mode: 'production-v12'/);
});
