import {
  buildTaskRecommenderV12ActionSet,
  buildTaskRecommenderV12TaskExposure,
  createTaskRecommenderV12TaskSnapshot,
} from './TaskRecommenderV12Encoding.js';
import { buildTaskRecommenderV12CandidateEvidence } from './TaskRecommenderV12CandidateEvidence.js';
import {
  countTaskRecommenderV12Parameters,
  createTaskRecommenderV12PosteriorSampler,
  encodeTaskRecommenderV12Event,
  replayTaskRecommenderV12Events,
  stepTaskRecommenderV12GRU,
} from './TaskRecommenderV12Model.js';
import {
  buildTaskRecommenderV12PolicyDecision,
  invalidateTaskRecommenderV12Budget,
  reserveTaskRecommenderV12Budget,
  resolveTaskRecommenderV12Budget,
} from './TaskRecommenderV12Policy.js';
import { getTaskRecommenderV12PolicyState } from './TaskRecommenderV12PolicyState.js';
import { getTaskRecommenderV12Checkpoint } from './TaskRecommenderV12Training.js';
import { getTaskRecommenderProtocolEvents } from './TaskRecommenderLedger.js';
import { resolveTaskRecommenderV12ServingPolicy } from './TaskRecommenderV12PolicyRegistry.js';
import {
  compareTaskRecommenderProtocolEvents,
  isTaskRecommenderProtocolEvent,
} from './TaskRecommenderProtocol.js';

export const TASK_RECOMMENDER_V12_WARM_SERVING_SCHEMA_VERSION = 2;
export const TASK_RECOMMENDER_V12_WARM_ACTION_CACHE_LIMIT = 4;
export const TASK_RECOMMENDER_V12_WARM_SCORING_P95_BUDGET_MS = 100;

const clock = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

function stableSerialize(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function fingerprint(value) {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}:${text.length}`;
}

function sourceFingerprint(todos = [], constraints = {}, contextToken = null) {
  const snapshots = (todos || []).map(createTaskRecommenderV12TaskSnapshot)
    .sort((left, right) => String(left.UUID).localeCompare(String(right.UUID)));
  return fingerprint({
    constraints,
    contextToken,
    tasks: snapshots.map((snapshot) => ({
      UUID: snapshot.UUID,
      contentHash: snapshot.contentHash,
    })),
  });
}

function boundedCacheSet(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > TASK_RECOMMENDER_V12_WARM_ACTION_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
}

function recurrentChecksum(state = []) {
  return state.reduce((sum, value, index) => sum + value * (index + 1), 0);
}

export async function createTaskRecommenderV12WarmServingSession({
  databaseConnection,
  currentPlayer,
  source = 'dojo',
  assignmentKey = null,
  now = new Date(),
} = {}) {
  if (!databaseConnection || !currentPlayer?.UUID) {
    throw new TypeError('A warm v12 serving session requires database and player');
  }
  const startedAt = clock();
  const playerUUID = String(currentPlayer.UUID);
  const storedCheckpoint = await getTaskRecommenderV12Checkpoint(databaseConnection, playerUUID);
  const [selection, initialEvents, policyStateResult] = await Promise.all([
    resolveTaskRecommenderV12ServingPolicy(
      databaseConnection,
      playerUUID,
      storedCheckpoint,
      {
        assignmentKey: String(assignmentKey || `${source}:warm-session`),
        occurredAt: now,
        source,
      },
    ),
    getTaskRecommenderProtocolEvents(databaseConnection, playerUUID),
    getTaskRecommenderV12PolicyState(databaseConnection, playerUUID),
  ]);
  const checkpoint = selection.checkpoint;
  const hydratedAt = clock();
  const model = checkpoint.model;
  const protocolEvents = [...initialEvents].sort(compareTaskRecommenderProtocolEvents);
  const knownEventUUIDs = new Set(protocolEvents.map((event) => String(event.UUID)));
  let recurrentState = replayTaskRecommenderV12Events(model, protocolEvents);
  let previousOccurredAt = protocolEvents.at(-1)?.occurredAt || null;
  let budgetState = policyStateResult.state.budget;
  let staged = null;
  let closed = false;
  let scoreCount = 0;
  let actionCacheHits = 0;
  let actionCacheMisses = 0;
  const actionCache = new Map();
  const posteriorSampler = createTaskRecommenderV12PosteriorSampler(model.posterior);

  const assertOpen = () => {
    if (closed) throw new Error('Warm v12 serving session is closed');
  };

  const observeProtocolEvents = (events = []) => {
    assertOpen();
    const additions = (events || [])
      .filter(isTaskRecommenderProtocolEvent)
      .filter((event) => !knownEventUUIDs.has(String(event.UUID)))
      .sort(compareTaskRecommenderProtocolEvents);
    for (const event of additions) {
      recurrentState = stepTaskRecommenderV12GRU(
        model.gru,
        encodeTaskRecommenderV12Event(event, previousOccurredAt),
        recurrentState,
      );
      previousOccurredAt = event.occurredAt || previousOccurredAt;
      protocolEvents.push(event);
      knownEventUUIDs.add(String(event.UUID));
    }
    return additions.length;
  };

  const score = ({
    todos = [],
    now = new Date(),
    decisionSeed,
    constraints = {},
    policyOptions = {},
    contextToken = null,
  } = {}) => {
    assertOpen();
    if (!decisionSeed) throw new TypeError('Warm v12 scoring requires decisionSeed');
    const fingerprintValue = sourceFingerprint(todos, constraints, contextToken);
    if (staged) {
      if (!staged.presented && staged.sourceFingerprint === fingerprintValue) {
        return staged.evaluation;
      }
      throw new Error('Warm v12 serving permits only one unresolved staged action');
    }
    const scoringStartedAt = clock();
    let actions = actionCache.get(fingerprintValue);
    if (actions) {
      actionCacheHits += 1;
      actionCache.delete(fingerprintValue);
      actionCache.set(fingerprintValue, actions);
    } else {
      actionCacheMisses += 1;
      actions = buildTaskRecommenderV12ActionSet(todos, {
        ...constraints,
        playerUUID,
      });
      boundedCacheSet(actionCache, fingerprintValue, actions);
    }
    if (!actions.length) return null;
    const evaluatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const context = {
      now,
      source,
      queueSize: new Set(actions.map((action) => action.taskUUID)).size,
      taskExposureByUUID: buildTaskRecommenderV12TaskExposure(protocolEvents, now),
    };
    const evaluated = buildTaskRecommenderV12PolicyDecision({
      model,
      recurrentState,
      actions,
      context,
      seed: String(decisionSeed),
      budgetState,
      options: {
        ...(selection.policyManifest?.policyOptions || {}),
        ...policyOptions,
        posteriorSampler,
      },
    });
    if (!evaluated) return null;
    const candidateEvidence = buildTaskRecommenderV12CandidateEvidence({
      playerUUID,
      candidateActions: evaluated.candidateActions,
      occurredAt: evaluatedAt,
      source,
      constraints,
    });
    scoreCount += 1;
    const evaluation = Object.freeze({
      warmServingSchemaVersion: TASK_RECOMMENDER_V12_WARM_SERVING_SCHEMA_VERSION,
      evaluatedAt,
      mode: 'production-v12-warm',
      policyDecision: Object.freeze({
        ...evaluated.policyDecision,
        evaluationAssignment: selection.assignment,
      }),
      policyAssignment: selection.assignment,
      candidateEvidence,
      recommendation: Object.freeze({
        actionKey: evaluated.action.actionKey,
        taskUUID: String(evaluated.action.taskUUID),
        durationSeconds: Number(evaluated.action.durationSeconds),
        predictedWorkHours: evaluated.action.mean,
        epistemicStdDevHours: evaluated.action.epistemicStdDev,
      }),
      sourceFingerprint: fingerprintValue,
      device: Object.freeze({
        hydrationMs: Math.max(0, hydratedAt - startedAt),
        scoringMs: Math.max(0, clock() - scoringStartedAt),
        scoringP95BudgetMs: TASK_RECOMMENDER_V12_WARM_SCORING_P95_BUDGET_MS,
        protocolEventCount: protocolEvents.length,
        actionCount: evaluated.candidateActions.length,
        parameterCount: countTaskRecommenderV12Parameters(model),
        checkpointBytes: JSON.stringify(model).length,
        warmScoreCount: scoreCount,
        actionCacheHits,
        actionCacheMisses,
      }),
    });
    staged = {
      evaluation,
      sourceFingerprint: fingerprintValue,
      decisionUUID: null,
      presented: false,
    };
    return evaluation;
  };

  return Object.freeze({
    warmServingSchemaVersion: TASK_RECOMMENDER_V12_WARM_SERVING_SCHEMA_VERSION,
    playerUUID,
    source,
    sourceFingerprint,
    score,
    observeProtocolEvents,
    attachDecision(decisionUUID, policyDecision, records = []) {
      assertOpen();
      if (!staged) throw new Error('Cannot attach a decision without a staged action');
      staged.decisionUUID = String(decisionUUID);
      budgetState = reserveTaskRecommenderV12Budget(
        budgetState,
        decisionUUID,
        policyDecision,
      );
      observeProtocolEvents(records);
    },
    markPresented(decisionUUID, records = []) {
      assertOpen();
      if (!staged || String(staged.decisionUUID) !== String(decisionUUID)) return false;
      staged.presented = true;
      observeProtocolEvents(records);
      return true;
    },
    resolve(decisionUUID, productiveSeconds = 0, records = []) {
      assertOpen();
      if (!staged || String(staged.decisionUUID) !== String(decisionUUID)) return false;
      observeProtocolEvents(records);
      budgetState = resolveTaskRecommenderV12Budget(
        budgetState,
        decisionUUID,
        productiveSeconds,
      );
      staged = null;
      return true;
    },
    invalidate(decisionUUID, records = []) {
      assertOpen();
      if (!staged || String(staged.decisionUUID) !== String(decisionUUID)) return false;
      observeProtocolEvents(records);
      budgetState = invalidateTaskRecommenderV12Budget(budgetState, decisionUUID);
      staged = null;
      return true;
    },
    peekStaged() {
      return staged ? Object.freeze({
        sourceFingerprint: staged.sourceFingerprint,
        decisionUUID: staged.decisionUUID,
        presented: staged.presented,
        evaluation: staged.evaluation,
      }) : null;
    },
    getDiagnostics() {
      return Object.freeze({
        protocolEventCount: protocolEvents.length,
        scoreCount,
        actionCacheSize: actionCache.size,
        actionCacheHits,
        actionCacheMisses,
        hasStagedAction: Boolean(staged),
        stagedPresented: Boolean(staged?.presented),
        recurrentCursorEventCount: protocolEvents.length,
        recurrentStateChecksum: recurrentChecksum(recurrentState),
        lastOccurredAt: previousOccurredAt,
      });
    },
    close() {
      closed = true;
      staged = null;
      actionCache.clear();
    },
  });
}
