import {
  buildTaskRecommenderV12ActionSet,
  buildTaskRecommenderV12TaskExposure,
} from './TaskRecommenderV12Encoding.js';
import { buildTaskRecommenderV12CandidateEvidence } from './TaskRecommenderV12CandidateEvidence.js';
import {
  countTaskRecommenderV12Parameters,
  replayTaskRecommenderV12Events,
} from './TaskRecommenderV12Model.js';
import { buildTaskRecommenderV12PolicyDecision } from './TaskRecommenderV12Policy.js';
import { getTaskRecommenderV12PolicyState } from './TaskRecommenderV12PolicyState.js';
import { getTaskRecommenderV12Checkpoint } from './TaskRecommenderV12Training.js';
import { getTaskRecommenderProtocolEvents } from './TaskRecommenderLedger.js';
import { resolveTaskRecommenderV12ServingPolicy } from './TaskRecommenderV12PolicyRegistry.js';

export const TASK_RECOMMENDER_V12_SERVING_SCHEMA_VERSION = 3;

const clock = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

export async function evaluateTaskRecommenderV12({
  databaseConnection,
  currentPlayer,
  todos = [],
  source = 'tasks',
  now = new Date(),
  decisionSeed,
  constraints = {},
  policyOptions = {},
} = {}) {
  if (!databaseConnection || !currentPlayer?.UUID || !decisionSeed) return null;
  const startedAt = clock();
  const storedCheckpoint = await getTaskRecommenderV12Checkpoint(
    databaseConnection,
    currentPlayer.UUID,
  );
  const [selection, protocolEvents, policyStateResult] = await Promise.all([
    resolveTaskRecommenderV12ServingPolicy(
      databaseConnection,
      currentPlayer.UUID,
      storedCheckpoint,
      {
        assignmentKey: String(decisionSeed),
        occurredAt: now,
        source,
      },
    ),
    getTaskRecommenderProtocolEvents(databaseConnection, currentPlayer.UUID),
    getTaskRecommenderV12PolicyState(databaseConnection, currentPlayer.UUID),
  ]);
  const checkpoint = selection.checkpoint;
  const hydratedAt = clock();
  const actions = buildTaskRecommenderV12ActionSet(todos, {
    ...constraints,
    playerUUID: currentPlayer.UUID,
  });
  if (!actions.length) return null;
  const context = {
    now,
    source,
    queueSize: new Set(actions.map((action) => action.taskUUID)).size,
    taskExposureByUUID: buildTaskRecommenderV12TaskExposure(protocolEvents, now),
  };
  const recurrentState = replayTaskRecommenderV12Events(checkpoint.model, protocolEvents);
  const evaluated = buildTaskRecommenderV12PolicyDecision({
    model: checkpoint.model,
    recurrentState,
    actions,
    context,
    seed: String(decisionSeed),
    budgetState: policyStateResult.state.budget,
    options: { ...(selection.policyManifest?.policyOptions || {}), ...policyOptions },
  });
  if (!evaluated) return null;
  const scoredAt = clock();
  const evaluatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const candidateEvidence = buildTaskRecommenderV12CandidateEvidence({
    playerUUID: currentPlayer.UUID,
    candidateActions: evaluated.candidateActions,
    occurredAt: evaluatedAt,
    source,
    constraints,
  });
  return Object.freeze({
    servingSchemaVersion: TASK_RECOMMENDER_V12_SERVING_SCHEMA_VERSION,
    evaluatedAt,
    mode: 'production-v12',
    shouldServeV12: true,
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
    device: Object.freeze({
      actionCount: evaluated.candidateActions.length,
      coarseActionCount: actions.length,
      protocolEventCount: protocolEvents.length,
      parameterCount: countTaskRecommenderV12Parameters(checkpoint.model),
      checkpointBytes: JSON.stringify(checkpoint.model).length,
      hydrationMs: Math.max(0, hydratedAt - startedAt),
      scoringMs: Math.max(0, scoredAt - hydratedAt),
      totalMs: Math.max(0, scoredAt - startedAt),
    }),
  });
}
