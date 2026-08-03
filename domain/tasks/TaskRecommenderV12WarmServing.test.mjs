import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const replaceImport = (source, specifier, url) => (
  source.replace(`from '${specifier}';`, `from '${url}';`)
);

const mathUrl = dataUrl(await readFile(new URL('./TaskRecommenderV12Math.js', import.meta.url), 'utf8'));
const encodingUrl = dataUrl(await readFile(
  new URL('./TaskRecommenderV12Encoding.js', import.meta.url),
  'utf8',
));
let candidateSource = await readFile(
  new URL('./TaskRecommenderV12CandidateEvidence.js', import.meta.url),
  'utf8',
);
candidateSource = candidateSource
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings' };")
  .replace("from './TaskRecommenderV12Encoding.js';", `from '${encodingUrl}';`);
const candidateUrl = dataUrl(candidateSource);
const modelUrl = dataUrl(replaceImport(
  await readFile(new URL('./TaskRecommenderV12Model.js', import.meta.url), 'utf8'),
  './TaskRecommenderV12Math.js',
  mathUrl,
));
const model = await import(modelUrl);
let policySource = await readFile(new URL('./TaskRecommenderV12Policy.js', import.meta.url), 'utf8');
policySource = replaceImport(policySource, './TaskRecommenderV12Encoding.js', encodingUrl);
policySource = replaceImport(policySource, './TaskRecommenderV12Model.js', modelUrl);
policySource = replaceImport(policySource, './TaskRecommenderV12Math.js', mathUrl);
const policyUrl = dataUrl(policySource);
const protocolUrl = dataUrl(await readFile(
  new URL('./TaskRecommenderProtocol.js', import.meta.url),
  'utf8',
));
const protocol = await import(protocolUrl);
const stateUrl = dataUrl(`
  export async function getTaskRecommenderV12PolicyState() {
    globalThis.__warmHydrationCalls.policy += 1;
    return { state: { budget: {} } };
  }
`);
const trainingUrl = dataUrl(`
  export async function getTaskRecommenderV12Checkpoint() {
    globalThis.__warmHydrationCalls.checkpoint += 1;
    return globalThis.__warmCheckpoint;
  }
`);
const ledgerUrl = dataUrl(`
  export async function getTaskRecommenderProtocolEvents() {
    globalThis.__warmHydrationCalls.ledger += 1;
    return [];
  }
`);
const registryUrl = dataUrl(`
  export async function resolveTaskRecommenderV12ServingPolicy(db, playerUUID, checkpoint) {
    return {
      checkpoint,
      policyManifest: null,
      assignment: { runtime: 'v12', policyUUID: 'current-test', assignmentProbability: 1 },
    };
  }
`);
let source = await readFile(
  new URL('./TaskRecommenderV12WarmServing.js', import.meta.url),
  'utf8',
);
for (const [specifier, url] of [
  ['./TaskRecommenderV12Encoding.js', encodingUrl],
  ['./TaskRecommenderV12CandidateEvidence.js', candidateUrl],
  ['./TaskRecommenderV12Model.js', modelUrl],
  ['./TaskRecommenderV12Policy.js', policyUrl],
  ['./TaskRecommenderV12PolicyState.js', stateUrl],
  ['./TaskRecommenderV12Training.js', trainingUrl],
  ['./TaskRecommenderLedger.js', ledgerUrl],
  ['./TaskRecommenderProtocol.js', protocolUrl],
  ['./TaskRecommenderV12PolicyRegistry.js', registryUrl],
]) source = replaceImport(source, specifier, url);
const warmServing = await import(dataUrl(source));

function event(type, sequence, decisionUUID = 'decision-1') {
  return protocol.createTaskRecommenderProtocolEvent({
    playerUUID: 'player-1',
    decisionUUID,
    taskUUID: 'task-a',
    type,
    eventKey: `${type}:${sequence}`,
    sequence,
    source: 'dojo',
    occurredAt: new Date(Date.UTC(2026, 6, 12, 12, sequence)).toISOString(),
    payload: {},
  });
}

test('warm serving hydrates once, caches action support, and conditions on persisted feedback', async () => {
  globalThis.__warmHydrationCalls = { checkpoint: 0, ledger: 0, policy: 0 };
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'warm-serving' });
  globalThis.__warmCheckpoint = {
    model: valueModel,
    targetModel: structuredClone(valueModel),
    manifest: { status: 'promoted' },
  };
  const tasks = [
    { UUID: 'task-a', parent: 'player-1', name: 'Draft', estimatedDuration: 20 },
    { UUID: 'task-b', parent: 'player-1', name: 'Review', estimatedDuration: 15 },
  ];
  const session = await warmServing.createTaskRecommenderV12WarmServingSession({
    databaseConnection: {},
    currentPlayer: { UUID: 'player-1' },
    source: 'dojo',
  });
  assert.deepEqual(globalThis.__warmHydrationCalls, { checkpoint: 1, ledger: 1, policy: 1 });

  const first = session.score({ todos: tasks, decisionSeed: 'warm-1' });
  assert.equal(session.score({ todos: tasks, decisionSeed: 'ignored' }), first);
  session.attachDecision('decision-1', first.policyDecision, [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated, 1),
  ]);
  session.markPresented('decision-1', [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented, 2),
  ]);
  assert.throws(
    () => session.score({ todos: tasks, decisionSeed: 'blocked' }),
    /one unresolved staged action/,
  );
  const beforeFeedback = session.getDiagnostics().recurrentStateChecksum;
  session.resolve('decision-1', 0, [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped, 3),
  ]);
  const afterFeedback = session.getDiagnostics();
  assert.equal(afterFeedback.recurrentCursorEventCount, 3);
  assert.notEqual(afterFeedback.recurrentStateChecksum, beforeFeedback);

  const second = session.score({ todos: tasks, decisionSeed: 'warm-2' });
  assert.ok(second);
  assert.equal(session.getDiagnostics().actionCacheHits, 1);
  assert.deepEqual(globalThis.__warmHydrationCalls, { checkpoint: 1, ledger: 1, policy: 1 });
  session.close();
});

test('an unpresented staged action is invalidatable after task duration changes', async () => {
  globalThis.__warmHydrationCalls = { checkpoint: 0, ledger: 0, policy: 0 };
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'warm-invalidation' });
  globalThis.__warmCheckpoint = {
    model: valueModel,
    targetModel: structuredClone(valueModel),
    manifest: null,
  };
  const original = [{
    UUID: 'task-a', parent: 'player-1', name: 'Draft', estimatedDuration: 20,
  }];
  const edited = [{ ...original[0], estimatedDuration: 45 }];
  const session = await warmServing.createTaskRecommenderV12WarmServingSession({
    databaseConnection: {},
    currentPlayer: { UUID: 'player-1' },
    source: 'dojo',
  });
  const staged = session.score({ todos: original, decisionSeed: 'original' });
  session.attachDecision('decision-edit', staged.policyDecision, [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated, 1, 'decision-edit'),
  ]);
  assert.notEqual(
    session.peekStaged().sourceFingerprint,
    session.sourceFingerprint(edited, {}),
  );
  session.invalidate('decision-edit', [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationInvalidated, 2, 'decision-edit'),
  ]);
  const replacement = session.score({ todos: edited, decisionSeed: 'edited' });
  assert.ok(replacement);
  assert.equal(session.getDiagnostics().hasStagedAction, true);
  assert.notEqual(
    session.peekStaged().sourceFingerprint,
    session.sourceFingerprint([], {}),
  );
  session.attachDecision('decision-delete', replacement.policyDecision, [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated, 3, 'decision-delete'),
  ]);
  session.invalidate('decision-delete', [
    event(protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationInvalidated, 4, 'decision-delete'),
  ]);
  assert.equal(session.score({ todos: [], decisionSeed: 'deleted' }), null);
  session.close();
});

test('warm scoring p95 stays inside the declared production scroll budget', async () => {
  globalThis.__warmHydrationCalls = { checkpoint: 0, ledger: 0, policy: 0 };
  const valueModel = model.createTaskRecommenderV12Model({ seed: 'warm-latency' });
  globalThis.__warmCheckpoint = {
    model: valueModel,
    targetModel: structuredClone(valueModel),
    manifest: { status: 'promoted' },
  };
  const tasks = [
    { UUID: 'task-a', parent: 'player-1', name: 'Draft', estimatedDuration: 20 },
    { UUID: 'task-b', parent: 'player-1', name: 'Review', estimatedDuration: 15 },
  ];
  const session = await warmServing.createTaskRecommenderV12WarmServingSession({
    databaseConnection: {},
    currentPlayer: { UUID: 'player-1' },
    source: 'dojo',
  });
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    const decisionUUID = `latency-${index}`;
    const sequence = index * 3 + 1;
    const evaluation = session.score({ todos: tasks, decisionSeed: decisionUUID });
    samples.push(evaluation.device.scoringMs);
    session.attachDecision(decisionUUID, evaluation.policyDecision, [
      event(protocol.TASK_RECOMMENDER_EVENT_TYPES.decisionCreated, sequence, decisionUUID),
    ]);
    session.markPresented(decisionUUID, [
      event(protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented, sequence + 1, decisionUUID),
    ]);
    session.resolve(decisionUUID, 0, [
      event(protocol.TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped, sequence + 2, decisionUUID),
    ]);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  assert.ok(
    p95 <= warmServing.TASK_RECOMMENDER_V12_WARM_SCORING_P95_BUDGET_MS,
    `warm scoring p95 ${p95.toFixed(2)}ms exceeded the production budget`,
  );
  assert.equal(session.getDiagnostics().scoreCount, 20);
  assert.equal(session.getDiagnostics().actionCacheHits, 19);
  session.close();
});
