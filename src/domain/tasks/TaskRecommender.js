import { v4 as uuid } from 'uuid';
import { MINUTE, STORES } from '@domain/constants.js';
import {
  exportTaskRecommendationV12Bundle,
  importTaskRecommendationV12Bundle,
  inferTaskRecommendationV12,
  getTaskRecommendationV12PrivateInferenceState,
  readTaskRecommendationV12Checkpoint,
  trainTaskRecommendationV12,
} from './TaskRecommendationV12.js';
import {
  createTaskRecommenderV12TaskSnapshot,
  isTaskRecommenderV12EligibleTask,
} from './TaskRecommenderV12Encoding.js';
import { validateTaskRecommenderV12CandidateEvidenceRecords } from './TaskRecommenderV12CandidateEvidence.js';
import {
  appendTaskRecommenderProtocolEvents,
  getTaskRecommenderProtocolEvents,
} from './TaskRecommenderLedger.js';
import {
  TASK_RECOMMENDER_EVENT_TYPES,
  TASK_RECOMMENDER_PROTOCOL_FAMILY,
  TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION,
  countTaskRecommenderResolvedDecisions,
  reduceTaskRecommenderDecision,
} from './TaskRecommenderProtocol.js';
import {
  invalidateTaskRecommenderV12PolicyDecision,
  reserveTaskRecommenderV12PolicyDecision,
  resolveTaskRecommenderV12PolicyDecision,
} from './TaskRecommenderV12PolicyState.js';
import {
  getTaskRecommenderV12Settings,
  isTaskRecommenderV12AutomaticTrainingEnabled,
  isTaskRecommenderV12TrainingEvidenceSufficient,
} from './TaskRecommenderV12Settings.js';
import { createTaskRecommenderV12WarmServingSession } from './TaskRecommenderV12WarmServing.js';

export const TASK_RECOMMENDER_ACTIVE_RUNTIME = 'v12';
export const TASK_RECOMMENDER_MODEL_VERSION = 12;
export const TASK_RECOMMENDER_POLICY_VERSION = 'dual-head-safe-v4';

const privateRecommendationState = new WeakMap();
const trainingSchedules = new WeakMap();
const runtimeObservationSessionUUID = uuid();

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

function normalizedTimestamp(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback).toISOString();
}

function formatMinutes(minutes) {
  const value = Math.max(1, Math.round(finite(minutes, 1)));
  return value < 60 ? `${value}m` : `${Math.floor(value / 60)}h ${value % 60}m`;
}

function publicRecommendation({ task, source, mode, inference, privateInferenceOverride = null }) {
  const minutes = Math.max(1, Number(inference.selected.durationSeconds) / 60);
  const privateInference = privateInferenceOverride
    || getTaskRecommendationV12PrivateInferenceState(inference);
  const evidenceState = privateInference?.policyDecision?.evidence?.phase
    || 'neutral-exploration';
  const explanation = evidenceState === 'supported'
    ? 'learned from verified work'
    : 'exploring task and duration patterns';
  const recommendation = {
    task,
    source,
    mode,
    evidenceState,
    actionKey: inference.selected.actionKey,
    actionType: 'task-session',
    suggestedMinutes: minutes,
    requiredTimerMinutes: minutes,
    reasonChips: [explanation],
    primaryReason: explanation,
    supportingReasons: [],
    expectedWorkloadImpact: `Schedules ${formatMinutes(minutes)} of focused work`,
  };
  privateRecommendationState.set(recommendation, {
    inference,
    policyDecision: privateInference?.policyDecision || null,
    candidateEvidence: privateInference?.candidateEvidence || null,
    policyAssignment: privateInference?.policyAssignment
      || privateInference?.policyDecision?.evaluationAssignment
      || null,
    device: privateInference?.device || null,
  });
  return recommendation;
}

export async function buildTaskRecommenderRecommendation({
  databaseConnection,
  currentPlayer,
  todos = [],
  source = 'tasks',
  mode = 'normal',
  targetMinutes = null,
  decisionSeed = null,
  now = null,
} = {}) {
  if (!databaseConnection || !currentPlayer?.UUID) return null;
  const owner = String(currentPlayer.UUID);
  const eligible = (todos || []).filter((task) => (
    isTaskRecommenderV12EligibleTask(task, owner)
  ));
  if (!eligible.length) return null;
  const constraints = Number.isFinite(Number(targetMinutes)) && Number(targetMinutes) > 0
    ? { targetDurationSeconds: Number(targetMinutes) * 60 }
    : {};
  const inference = await inferTaskRecommendationV12(databaseConnection, {
    requestId: uuid(),
    playerUUID: owner,
    source,
    decisionSeed: decisionSeed || uuid(),
    now: now ? new Date(now).toISOString() : new Date().toISOString(),
    tasks: eligible,
    constraints,
  });
  if (!inference.selected) return null;
  const task = eligible.find((candidate) => (
    String(candidate.UUID) === String(inference.selected.taskUUID)
  ));
  return task ? publicRecommendation({ task, source, mode, inference }) : null;
}

export async function createTaskRecommenderWarmSession({
  databaseConnection,
  currentPlayer,
  source = 'dojo',
  observationSessionUUID = runtimeObservationSessionUUID,
} = {}) {
  if (!databaseConnection || !currentPlayer?.UUID) return null;
  const owner = String(currentPlayer.UUID);
  const serving = await createTaskRecommenderV12WarmServingSession({
    databaseConnection,
    currentPlayer: { UUID: owner },
    source,
    assignmentKey: observationSessionUUID,
  });
  let staged = null;
  let lifecycleQueue = Promise.resolve();
  let closed = false;
  const serializeLifecycle = (operation) => {
    const run = lifecycleQueue.catch(() => undefined).then(operation);
    lifecycleQueue = run.catch(() => undefined);
    return run;
  };

  const session = {
    async stage({
      todos = [], mode = 'normal', targetMinutes = null, decisionSeed = uuid(), contextToken = null,
    } = {}) {
      if (closed) throw new Error('Task recommender warm session is closed');
      const eligible = (todos || []).filter((task) => (
        isTaskRecommenderV12EligibleTask(task, owner)
      ));
      if (!eligible.length) return null;
      const constraints = Number.isFinite(Number(targetMinutes)) && Number(targetMinutes) > 0
        ? { targetDurationSeconds: Number(targetMinutes) * 60 }
        : {};
      const evaluation = serving.score({
        todos: eligible,
        now: new Date(),
        decisionSeed,
        constraints,
        contextToken,
      });
      if (!evaluation) return null;
      const task = eligible.find((candidate) => (
        String(candidate.UUID) === String(evaluation.recommendation.taskUUID)
      ));
      if (!task) return null;
      const inference = {
        selected: evaluation.recommendation,
        behaviorProbability: evaluation.policyDecision.selected.jointBehaviorProbability,
      };
      const recommendation = publicRecommendation({
        task,
        source,
        mode,
        inference,
        privateInferenceOverride: {
          policyDecision: evaluation.policyDecision,
          candidateEvidence: evaluation.candidateEvidence,
          device: evaluation.device,
          policyAssignment: evaluation.policyAssignment,
        },
      });
      const event = await recordTaskRecommendationDecision(
        databaseConnection,
        { UUID: owner },
        recommendation,
        source,
        { observationSessionUUID },
      );
      if (!event) return null;
      serving.attachDecision(
        event.decisionUUID,
        evaluation.policyDecision,
        event.protocolRecords,
      );
      staged = {
        recommendation, event, evaluation, constraints, contextToken, presented: false,
      };
      return Object.freeze({ ...staged });
    },
    present(item, options = {}) {
      return serializeLifecycle(async () => {
        if (!staged || staged.event.UUID !== item?.event?.UUID) return null;
        const record = await recordTaskRecommendationPresentation(
          databaseConnection,
          staged.event.UUID,
          { ...options, observationSessionUUID },
        );
        if (record) {
          staged.presented = true;
          serving.markPresented(staged.event.decisionUUID, [record]);
        }
        return record;
      });
    },
    accumulateVisibility(item, options = {}) {
      return serializeLifecycle(async () => {
        if (!staged || staged.event.UUID !== item?.event?.UUID || !staged.presented) return null;
        const record = await recordTaskRecommendationVisibility(
          databaseConnection,
          staged.event.UUID,
          options,
        );
        if (record) serving.observeProtocolEvents([record]);
        return record;
      });
    },
    skip(item, reason = 'dojo-scroll-skip', options = {}) {
      return serializeLifecycle(async () => {
        if (!staged || staged.event.UUID !== item?.event?.UUID || !staged.presented) return null;
        const result = await recordTaskRecommendationOutcome(
          databaseConnection,
          staged.event.UUID,
          'dismissed',
          { ...options, reason },
        );
        if (result) {
          serving.resolve(staged.event.decisionUUID, 0, result.records);
          staged = null;
        }
        return result;
      });
    },
    accept(item, options = {}) {
      return serializeLifecycle(async () => {
        if (!staged || staged.event.UUID !== item?.event?.UUID || !staged.presented) return null;
        const result = await recordTaskRecommendationOutcome(
          databaseConnection,
          staged.event.UUID,
          'accepted',
          options,
        );
        if (result?.records) serving.observeProtocolEvents(result.records);
        return result;
      });
    },
    invalidate(item, reason = 'staged-context-changed') {
      return serializeLifecycle(async () => {
        if (!staged || staged.event.UUID !== item?.event?.UUID || staged.presented) return null;
        const result = await invalidateTaskRecommendationDecision(
          databaseConnection,
          staged.event.UUID,
          reason,
        );
        if (result) {
          serving.invalidate(staged.event.decisionUUID, result.protocolRecords);
          staged = null;
        }
        return result;
      });
    },
    sourceMatches(todos = [], constraints = {}, contextToken = null) {
      const current = serving.peekStaged();
      return !current || current.sourceFingerprint
        === serving.sourceFingerprint(todos, constraints, contextToken);
    },
    peekStaged() {
      return staged ? { ...staged } : null;
    },
    getDiagnostics: serving.getDiagnostics,
    async close() {
      if (closed) return;
      if (staged && !staged.presented) {
        await session.invalidate(staged, 'warm-session-closed').catch(() => null);
      }
      await lifecycleQueue.catch(() => undefined);
      serving.close();
      staged = null;
      closed = true;
    },
  };
  return Object.freeze(session);
}

export function applyTaskRecommendationToTask(recommendation, event = null) {
  if (!recommendation?.task) return null;
  const reasonToSelect = `Suggested because: ${(recommendation.reasonChips || []).join(' · ') || recommendation.primaryReason}`;
  const sessionMinutes = Math.max(
    0,
    Number(
      recommendation.requiredTimerMinutes
      || recommendation.suggestedMinutes
      || recommendation.task.estimatedDuration
      || 0,
    ),
  );
  return {
    ...recommendation.task,
    reasonToSelect,
    sessionDuration: sessionMinutes * MINUTE,
    recommendation: {
      evidenceState: recommendation.evidenceState,
      primaryReason: recommendation.primaryReason,
      supportingReasons: recommendation.supportingReasons || [],
      expectedWorkloadImpact: recommendation.expectedWorkloadImpact,
      suggestedMinutes: sessionMinutes,
      requiredTimerMinutes: sessionMinutes,
      mode: recommendation.mode,
      source: recommendation.source,
      selectedAt: new Date().toISOString(),
      eventUUID: event?.UUID || null,
    },
    taskRecommendationEventId: event?.UUID || null,
    taskRecommendationSource: recommendation.source || 'tasks',
  };
}

export async function recordTaskRecommendationDecision(
  databaseConnection,
  currentPlayer,
  recommendation,
  source = 'tasks',
  options = {},
) {
  if (!databaseConnection || !currentPlayer?.UUID || !recommendation?.task?.UUID) return null;
  const owner = String(currentPlayer.UUID);
  const decisionUUID = String(options.decisionUUID || uuid());
  const occurredAt = normalizedTimestamp(options.occurredAt);
  const durationSeconds = Math.max(
    60,
    finite(recommendation.requiredTimerMinutes || recommendation.suggestedMinutes, 1) * 60,
  );
  const privateState = privateRecommendationState.get(recommendation) || {};
  const policyDecision = privateState.policyDecision;
  const candidateEvidence = privateState.candidateEvidence;
  const observationSessionUUID = String(
    options.observationSessionUUID || runtimeObservationSessionUUID,
  );
  const selectedSnapshotUUID = candidateEvidence?.manifest?.actions?.find((action) => (
    action.actionKey === recommendation.actionKey
  ))?.snapshotUUID;
  const selectedSnapshot = candidateEvidence?.records?.find((put) => (
    put.record?.UUID === selectedSnapshotUUID
  ))?.record?.value?.snapshot;
  const taskSnapshot = selectedSnapshot || createTaskRecommenderV12TaskSnapshot(recommendation.task);
  const inputs = [{
      playerUUID: owner,
      decisionUUID,
      type: TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
      eventKey: 'active:decision-created',
      occurredAt,
      source,
      taskUUID: recommendation.task.UUID,
      origin: 'v12-policy',
      payload: {
        actionKey: recommendation.actionKey,
        proposedDurationSeconds: durationSeconds,
        taskSnapshot,
        behaviorProbability: Number.isFinite(Number(privateState.inference?.behaviorProbability))
          ? Number(privateState.inference.behaviorProbability)
          : null,
        observationSessionUUID,
        policyDecision,
        candidateManifest: candidateEvidence?.manifest || null,
        policyAssignment: privateState.policyAssignment
          || policyDecision?.evaluationAssignment
          || null,
        deviceEvidence: privateState.device || null,
      },
    }];
  if (candidateEvidence) {
    await validateTaskRecommenderV12CandidateEvidenceRecords(
      databaseConnection,
      candidateEvidence,
    );
  }
  const records = await appendTaskRecommenderProtocolEvents(databaseConnection, inputs, {
    additionalPuts: candidateEvidence?.records || [],
  });
  const decisionRecord = records.find((record) => (
    record.type === TASK_RECOMMENDER_EVENT_TYPES.decisionCreated
  ));
  if (policyDecision) {
    await reserveTaskRecommenderV12PolicyDecision(
      databaseConnection,
      owner,
      decisionUUID,
      policyDecision,
    );
  }
  return {
    UUID: decisionRecord?.UUID || decisionUUID,
    decisionUUID,
    parent: owner,
    protocolFamily: TASK_RECOMMENDER_PROTOCOL_FAMILY,
    type: TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
    taskUUID: String(recommendation.task.UUID),
    taskSnapshot: {
      ...taskSnapshot,
      suggestedMinutes: durationSeconds / 60,
      requiredTimerMinutes: durationSeconds / 60,
    },
    actionKey: recommendation.actionKey,
    source,
    observationSessionUUID,
    createdAt: occurredAt,
    protocolRecords: records,
  };
}

export async function recordTaskRecommendationPresentation(
  databaseConnection,
  eventId,
  options = {},
) {
  const resolved = await resolveDecision(databaseConnection, eventId);
  if (!resolved || resolved.state.invalidatedAt) return null;
  const existing = resolved.events.find((event) => (
    event.type === TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented
  ));
  if (existing) return existing;
  const occurredAt = normalizedTimestamp(options.occurredAt);
  const records = await appendTaskRecommenderProtocolEvents(databaseConnection, [{
    ...decisionBase(resolved, occurredAt),
    type: TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented,
    eventKey: options.impressionKey || 'active:recommendation-presented',
    origin: 'visibility-observer',
    payload: {
      position: Number.isFinite(Number(options.position)) ? Number(options.position) : null,
      visibleMs: Math.max(0, finite(options.visibleMs)),
      minimumVisibleRatio: Number.isFinite(Number(options.minimumVisibleRatio))
        ? Number(options.minimumVisibleRatio)
        : null,
      observationSessionUUID: options.observationSessionUUID
        || resolved.state.observationSessionUUID,
    },
  }]);
  return records[0] || null;
}

export async function recordTaskRecommendationImpression(
  databaseConnection,
  currentPlayer,
  recommendation,
  source = 'tasks',
  options = {},
) {
  const decision = await recordTaskRecommendationDecision(
    databaseConnection,
    currentPlayer,
    recommendation,
    source,
    options,
  );
  if (!decision) return null;
  const presentation = await recordTaskRecommendationPresentation(
    databaseConnection,
    decision.UUID,
    options,
  );
  return { ...decision, presentation, protocolRecords: [
    ...(decision.protocolRecords || []),
    ...(presentation ? [presentation] : []),
  ] };
}

async function resolveDecision(databaseConnection, eventId) {
  const record = await databaseConnection.get(STORES.recommenderEvent, eventId).catch(() => null);
  if (!record || record.protocolFamily !== TASK_RECOMMENDER_PROTOCOL_FAMILY) return null;
  const all = await getTaskRecommenderProtocolEvents(databaseConnection, record.parent);
  const events = all.filter((event) => event.decisionUUID === record.decisionUUID);
  return {
    owner: record.parent,
    decisionUUID: record.decisionUUID,
    taskUUID: record.taskUUID,
    source: record.source || 'tasks',
    events,
    state: reduceTaskRecommenderDecision(events, record.decisionUUID),
    decision: events.find((event) => event.type === TASK_RECOMMENDER_EVENT_TYPES.decisionCreated),
  };
}

export async function recordTaskRecommendationVisibility(
  databaseConnection,
  eventId,
  options = {},
) {
  const resolved = await resolveDecision(databaseConnection, eventId);
  if (!resolved?.state.presentedAt || resolved.state.invalidatedAt) return null;
  if (['skipped', 'session-finished', 'completed'].includes(resolved.state.status)) return null;
  const visibleMs = Math.max(0, finite(options.visibleMs));
  if (!(visibleMs > 0)) return null;
  const occurredAt = normalizedTimestamp(options.occurredAt);
  const segmentId = String(options.segmentId || uuid());
  const records = await appendTaskRecommenderProtocolEvents(databaseConnection, [{
    ...decisionBase(resolved, occurredAt),
    type: TASK_RECOMMENDER_EVENT_TYPES.recommendationVisibilityAccumulated,
    eventKey: `active:visibility:${segmentId}`,
    origin: 'visibility-observer',
    payload: {
      segmentId,
      visibleMs,
      visibleStartedAt: options.visibleStartedAt
        ? normalizedTimestamp(options.visibleStartedAt)
        : null,
      visibleEndedAt: occurredAt,
    },
  }]);
  return records[0] || null;
}

export async function invalidateTaskRecommendationDecision(
  databaseConnection,
  eventId,
  reason = 'staged-context-changed',
  options = {},
) {
  const resolved = await resolveDecision(databaseConnection, eventId);
  if (!resolved || resolved.state.presentedAt || resolved.state.invalidatedAt) return null;
  if (resolved.state.status !== 'created') return null;
  const occurredAt = normalizedTimestamp(options.occurredAt);
  const records = await appendTaskRecommenderProtocolEvents(databaseConnection, [{
    ...decisionBase(resolved, occurredAt),
    type: TASK_RECOMMENDER_EVENT_TYPES.recommendationInvalidated,
    eventKey: `active:invalidated:${reason}`,
    origin: 'v12-policy',
    payload: { reason },
  }]);
  await invalidateTaskRecommenderV12PolicyDecision(
    databaseConnection,
    resolved.owner,
    resolved.decisionUUID,
  );
  return {
    event: records[0] || null,
    decisionUUID: resolved.decisionUUID,
    protocolRecords: records,
  };
}

function decisionBase(resolved, occurredAt) {
  return {
    playerUUID: resolved.owner,
    decisionUUID: resolved.decisionUUID,
    source: resolved.source,
    taskUUID: resolved.taskUUID,
    origin: 'user',
    occurredAt,
  };
}

function proposedSeconds(resolved) {
  return Math.max(0, finite(
    resolved.decision?.payload?.proposedDurationSeconds,
    resolved.state.proposedDurationSeconds,
  ));
}

export async function recordTaskRecommendationOutcome(
  databaseConnection,
  eventId,
  outcome,
  options = {},
) {
  if (!databaseConnection || !eventId) return null;
  const resolved = await resolveDecision(databaseConnection, eventId);
  if (!resolved) return null;
  const completionEventUUID = options.completionEventUUID || null;
  if (completionEventUUID) {
    const duplicate = resolved.events.find((event) => {
      const entry = event?.payload;
      return entry?.completionEventUUID === completionEventUUID;
    });
    if (duplicate) return duplicate;
  }
  const normalized = ['accepted', 'partial', 'completed'].includes(String(outcome))
    ? String(outcome)
    : 'dismissed';
  if (resolved.state.invalidatedAt || !resolved.state.presentedAt) return null;
  if (['skipped', 'session-finished', 'completed'].includes(resolved.state.status)) return null;
  const occurredAt = normalizedTimestamp(options.occurredAt || options.sessionFinishedAt);
  const sessionStartedAt = normalizedTimestamp(options.sessionStartedAt, occurredAt);
  const sessionFinishedAt = normalizedTimestamp(options.sessionFinishedAt, occurredAt);
  const completedAt = normalizedTimestamp(options.completedAt, sessionFinishedAt);
  const base = decisionBase(resolved, occurredAt);
  const proposedDurationSeconds = proposedSeconds(resolved);
  const acceptedDurationSeconds = Math.max(
    0,
    finite(options.acceptedMinutes, proposedDurationSeconds / 60) * 60,
  );
  const productiveSeconds = Math.max(0, finite(options.actualMs)) / 1000;
  const committedSeconds = Math.max(0, finite(options.committedMs)) / 1000;
  const resultKey = options.completionEventUUID
    || `${normalized}:${options.reason || 'recorded'}:${acceptedDurationSeconds}:${productiveSeconds}`;
  const inputs = [];

  if (normalized === 'dismissed' && !resolved.state.acceptedAt && !resolved.state.sessionStartedAt) {
    inputs.push({
      ...base,
      type: TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped,
      eventKey: `active:skipped:${resultKey}`,
      payload: { reason: options.reason || null, rawOutcome: outcome || null },
    });
  } else {
    if (!resolved.state.acceptedAt) {
      inputs.push({
        ...base,
        occurredAt: sessionStartedAt,
        type: TASK_RECOMMENDER_EVENT_TYPES.recommendationAccepted,
        eventKey: 'active:accepted',
        payload: { proposedDurationSeconds, acceptedDurationSeconds },
      });
    }
    if (acceptedDurationSeconds !== proposedDurationSeconds) {
      inputs.push({
        ...base,
        occurredAt: sessionStartedAt,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskSessionDurationChanged,
        eventKey: `active:duration:${acceptedDurationSeconds}`,
        payload: { proposedDurationSeconds, acceptedDurationSeconds },
      });
    }
    if (!resolved.state.sessionStartedAt) {
      inputs.push({
        ...base,
        occurredAt: sessionStartedAt,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskSessionStarted,
        eventKey: 'active:session-started',
        payload: { acceptedDurationSeconds, committedSeconds },
      });
    }
    if (normalized === 'partial' || normalized === 'completed' || normalized === 'dismissed') {
      inputs.push({
        ...base,
        occurredAt: sessionFinishedAt,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished,
        eventKey: `active:session-finished:${resultKey}`,
        payload: {
          productiveSeconds,
          committedSeconds,
          acceptedDurationSeconds,
          sessionTimingSchemaVersion: TASK_RECOMMENDER_SESSION_TIMING_SCHEMA_VERSION,
          sessionStartedAt,
          sessionFinishedAt,
          reason: options.reason || null,
          completionEventUUID: options.completionEventUUID || null,
        },
      });
    }
    if (normalized === 'completed') {
      inputs.push({
        ...base,
        occurredAt: completedAt,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskRecordedComplete,
        eventKey: `active:task-complete:${options.completionEventUUID || resultKey}`,
        payload: {
          completedTaskUUID: options.completedTaskUUID || resolved.taskUUID,
          completionEventUUID: options.completionEventUUID || null,
        },
      });
    }
  }

  const records = await appendTaskRecommenderProtocolEvents(databaseConnection, inputs);
  if (normalized !== 'accepted') {
    await resolveTaskRecommenderV12PolicyDecision(
      databaseConnection,
      resolved.owner,
      resolved.decisionUUID,
      productiveSeconds,
    );
  }
  if (normalized !== 'accepted' && !options.skipTraining) {
    scheduleTaskRecommenderTraining(databaseConnection, resolved.owner);
  }
  return {
    UUID: eventId,
    decisionUUID: resolved.decisionUUID,
    parent: resolved.owner,
    outcome: normalized,
    outcomeAt: normalized === 'completed' ? completedAt : sessionFinishedAt,
    records,
  };
}

export async function recordTaskRecommendationSessionResult(databaseConnection, eventId, options = {}) {
  if (!eventId) return null;
  const committedMs = Math.max(0, finite(options.committedMs));
  const actualMs = Math.max(0, finite(options.actualMs));
  const completed = options.completed === true || (committedMs > 0 && actualMs >= committedMs);
  // Once a session has started, its continuous logged duration is the factual
  // signal. Do not manufacture a learned partial/dismissed boundary at 30s.
  const outcome = completed ? 'completed' : 'partial';
  return recordTaskRecommendationOutcome(databaseConnection, eventId, outcome, {
    ...options,
    committedMs,
    actualMs,
    reason: options.reason || (completed ? 'commitment-met' : 'commitment-not-met'),
  });
}

export async function dismissRecommendationForTask(databaseConnection, task, reason = 'preview-exit') {
  const eventId = task?.taskRecommendationEventId || task?.recommendation?.eventUUID;
  if (!eventId) return null;
  return recordTaskRecommendationOutcome(databaseConnection, eventId, 'dismissed', { reason });
}

export async function recordTaskRecommendationManualChoice(
  databaseConnection,
  currentPlayer,
  chosenTask,
  recommendationEvent = null,
  source = 'tasks',
) {
  if (!databaseConnection || !currentPlayer?.UUID || !chosenTask?.UUID || !recommendationEvent?.UUID) return null;
  if (String(chosenTask.UUID) === String(recommendationEvent.taskUUID || '')) return null;
  const resolved = await resolveDecision(databaseConnection, recommendationEvent.UUID);
  if (!resolved) return null;
  const occurredAt = new Date().toISOString();
  await appendTaskRecommenderProtocolEvents(databaseConnection, [{
    ...decisionBase(resolved, occurredAt),
    type: TASK_RECOMMENDER_EVENT_TYPES.manualAlternativeSelected,
    eventKey: `active:manual:${chosenTask.UUID}`,
    taskUUID: chosenTask.UUID,
    payload: {
      selectedTaskUUID: chosenTask.UUID,
      comparedTaskUUID: resolved.taskUUID,
      projectId: chosenTask.projectId || null,
    },
  }]);
  if (!resolved.state.skippedAt && !resolved.state.acceptedAt) {
    await recordTaskRecommendationOutcome(
      databaseConnection,
      recommendationEvent.UUID,
      'dismissed',
      { reason: 'manual-alternative-started' },
    );
  }
  return recommendationEvent;
}

export function trainTaskRecommender(databaseConnection, playerUUID, options = {}) {
  if (!databaseConnection || !playerUUID) return Promise.resolve(null);
  return trainTaskRecommendationV12(databaseConnection, {
    requestId: uuid(),
    playerUUID: String(playerUUID),
    options,
  });
}

function scheduleTaskRecommenderTraining(databaseConnection, playerUUID) {
  if (!databaseConnection || !playerUUID) return;
  let byPlayer = trainingSchedules.get(databaseConnection);
  if (!byPlayer) {
    byPlayer = new Map();
    trainingSchedules.set(databaseConnection, byPlayer);
  }
  const key = String(playerUUID);
  if (byPlayer.has(key)) return;
  const run = async () => {
    byPlayer.delete(key);
    try {
      const [settings, events] = await Promise.all([
        getTaskRecommenderV12Settings(databaseConnection, key),
        getTaskRecommenderProtocolEvents(databaseConnection, key),
      ]);
      if (!isTaskRecommenderV12AutomaticTrainingEnabled(settings)) return;
      const resolvedDecisionCount = countTaskRecommenderResolvedDecisions(events);
      if (!isTaskRecommenderV12TrainingEvidenceSufficient(settings, resolvedDecisionCount)) return;
      await trainTaskRecommender(databaseConnection, key);
    } catch (error) {
      console.warn('[TaskRecommender] v12 training failed:', error);
    }
  };
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const token = window.requestIdleCallback(run, { timeout: 8_000 });
    byPlayer.set(key, { type: 'idle', token });
  } else {
    const token = setTimeout(run, 0);
    byPlayer.set(key, { type: 'timer', token });
  }
}

export async function launchRecommendedTask(databaseConnection, currentPlayer, options = {}) {
  if (!currentPlayer?.UUID) return null;
  const todos = options.todos
    ? options.todos
    : await databaseConnection.getAll(STORES.todo);
  const recommendation = await buildTaskRecommenderRecommendation({
    databaseConnection,
    currentPlayer,
    todos,
    source: options.source || 'tasks',
    mode: options.mode || 'normal',
    targetMinutes: options.targetMinutes,
  });
  if (!recommendation) return null;
  const event = await recordTaskRecommendationImpression(
    databaseConnection,
    currentPlayer,
    recommendation,
    options.source || 'tasks',
    { observationSessionUUID: options.observationSessionUUID },
  );
  const task = applyTaskRecommendationToTask(recommendation, event);
  return { task, recommendation, event };
}

// v12-native export/import names retained here for callers that load the active
// task recommender module dynamically.
export {
  exportTaskRecommendationV12Bundle,
  importTaskRecommendationV12Bundle,
  readTaskRecommendationV12Checkpoint,
};
