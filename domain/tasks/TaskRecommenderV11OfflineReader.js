/**
 * Offline-only v11 adapter.
 *
 * This module is the sole runtime-readable boundary for legacy recommender
 * records. It is imported only by the one-time v12 migration coordinator and
 * must never be imported by inference, training, Settings, or UI modules.
 */
import { TASK_RECOMMENDER_EVENT_TYPES } from './TaskRecommenderProtocol.js';

export const TASK_RECOMMENDER_V11_OFFLINE_READER_VERSION = 1;
export const TASK_RECOMMENDER_V11_SETTINGS_ID = 'taskRecommenderSettings';
export const TASK_RECOMMENDER_V11_WEIGHTS_PREFIX = 'taskRecommenderWeights';

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const iso = (value, fallback = Date.now()) => {
  const date = new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(fallback).toISOString();
};

const clone = (value) => JSON.parse(JSON.stringify(value));


function portableTaskField(value) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(portableTaskField);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, portableTaskField(entry)]));
  }
  return String(value);
}

function v12TaskSnapshot(task = {}, fallback = {}) {
  return {
    UUID: String(task.UUID || fallback.taskUUID || ''),
    parent: task.parent == null ? String(fallback.playerUUID || '') : String(task.parent),
    name: String(task.name || task.title || ''),
    description: String(task.description || ''),
    projectId: task.projectId == null ? null : String(task.projectId),
    goalId: task.goalId == null ? null : String(task.goalId),
    estimatedDuration: Number.isFinite(Number(task.estimatedDuration))
      ? Number(task.estimatedDuration)
      : null,
    dueDate: task.dueDate == null ? null : portableTaskField(task.dueDate),
    createdAt: task.createdAt == null ? null : portableTaskField(task.createdAt),
    updatedAt: task.updatedAt == null ? null : portableTaskField(task.updatedAt),
    priority: task.priority == null ? null : portableTaskField(task.priority),
    aversion: task.aversion == null ? null : portableTaskField(task.aversion),
    repeat: task.repeat == null ? null : portableTaskField(task.repeat),
    repeats: task.repeats == null ? null : portableTaskField(task.repeats),
    repeatRule: task.repeatRule == null ? null : portableTaskField(task.repeatRule),
    recurrence: task.recurrence == null ? null : portableTaskField(task.recurrence),
    tags: Array.isArray(task.tags) ? task.tags.map((tag) => String(tag)) : [],
    encoderVersion: 1,
  };
}

export function isTaskRecommenderV11SettingRecord(record = null) {
  const id = String(record?.UUID || '');
  return id === TASK_RECOMMENDER_V11_SETTINGS_ID
    || id === TASK_RECOMMENDER_V11_WEIGHTS_PREFIX
    || id.startsWith(`${TASK_RECOMMENDER_V11_WEIGHTS_PREFIX}:`);
}

function legacyOutcomes(event = {}) {
  if (Array.isArray(event.outcomeHistory) && event.outcomeHistory.length) {
    return event.outcomeHistory;
  }
  if (!event.outcome && !event.rawOutcome) return [];
  return [{
    recordedAt: event.outcomeAt || event.createdAt,
    rawOutcome: event.rawOutcome || event.outcome,
    normalizedOutcome: event.outcome,
    reason: event.outcomeReason || null,
    suggestedMinutes: event.suggestedMinutes ?? event.taskSnapshot?.suggestedMinutes,
    acceptedMinutes: event.acceptedMinutes,
    committedMs: event.committedMs,
    actualMs: event.actualMs,
    completedTaskUUID: event.completedTaskUUID,
    completionEventUUID: event.completionEventUUID,
  }];
}

function recommendationInputs(event) {
  const durationMinutes = finite(
    event.taskSnapshot?.requiredTimerMinutes ?? event.taskSnapshot?.suggestedMinutes,
    finite(event.suggestedMinutes),
  );
  const decisionUUID = String(event.UUID);
  const occurredAt = iso(event.createdAt);
  const base = {
    playerUUID: String(event.parent),
    decisionUUID,
    source: event.source || 'tasks',
    taskUUID: String(event.taskUUID),
    origin: 'offline-v11-migration',
  };
  const protocolInputs = [
    {
      ...base,
      type: TASK_RECOMMENDER_EVENT_TYPES.decisionCreated,
      eventKey: 'v11:decision-created',
      occurredAt,
      payload: {
        legacySourceUUID: decisionUUID,
        actionKey: event.actionKey || `${event.taskUUID}:${Math.max(1, durationMinutes) * 60}`,
        proposedDurationSeconds: Math.max(1, durationMinutes) * 60,
        taskSnapshot: v12TaskSnapshot(event.taskSnapshot, {
          playerUUID: event.parent,
          taskUUID: event.taskUUID,
        }),
        behaviorProbability: Number.isFinite(Number(event.probability))
          ? Number(event.probability)
          : null,
        propensityStatus: event.v12Evaluation
          ? 'legacy-recorded-counterfactual-probability'
          : 'legacy-unverifiable',
        sourceVersions: {
          modelVersion: event.modelVersion ?? null,
          algorithm: event.algorithm ?? event.model?.algorithm ?? null,
          policyVersion: event.policyVersion ?? event.model?.policyVersion ?? null,
        },
      },
    },
    {
      ...base,
      type: TASK_RECOMMENDER_EVENT_TYPES.recommendationPresented,
      eventKey: 'v11:recommendation-presented',
      occurredAt,
      payload: {
        legacySourceUUID: decisionUUID,
        position: event.position ?? null,
        visibleMs: Math.max(0, finite(event.visibleMs)),
      },
    },
  ];

  legacyOutcomes(event).forEach((outcome, index) => {
    const normalized = String(
      outcome.normalizedOutcome || outcome.rawOutcome || '',
    ).toLowerCase();
    const outcomeAt = iso(outcome.recordedAt || outcome.occurredAt, event.outcomeAt || occurredAt);
    const eventKey = `v11:outcome:${index}:${outcome.completionEventUUID || outcome.reason || normalized}`;
    const proposedDurationSeconds = Math.max(1, durationMinutes) * 60;
    const acceptedDurationSeconds = Math.max(
      0,
      finite(outcome.acceptedMinutes, durationMinutes) * 60,
    );
    const payload = {
      legacySourceUUID: decisionUUID,
      rawOutcome: outcome.rawOutcome || normalized || null,
      reason: outcome.reason || null,
      proposedDurationSeconds,
      acceptedDurationSeconds,
    };

    if (['dismissed', 'ignored', 'quick-skip'].includes(normalized)) {
      protocolInputs.push({
        ...base,
        type: TASK_RECOMMENDER_EVENT_TYPES.recommendationSkipped,
        eventKey,
        occurredAt: outcomeAt,
        payload,
      });
      return;
    }

    if (['accepted', 'partial', 'completed'].includes(normalized)) {
      protocolInputs.push({
        ...base,
        type: TASK_RECOMMENDER_EVENT_TYPES.recommendationAccepted,
        eventKey: `${eventKey}:accepted`,
        occurredAt: outcomeAt,
        payload,
      });
      if (acceptedDurationSeconds !== proposedDurationSeconds) {
        protocolInputs.push({
          ...base,
          type: TASK_RECOMMENDER_EVENT_TYPES.taskSessionDurationChanged,
          eventKey: `${eventKey}:duration`,
          occurredAt: outcomeAt,
          payload,
        });
      }
      protocolInputs.push({
        ...base,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskSessionStarted,
        eventKey: `${eventKey}:started`,
        occurredAt: outcomeAt,
        payload: {
          ...payload,
          committedSeconds: Math.max(0, finite(outcome.committedMs)) / 1000,
        },
      });
    }

    const productiveSeconds = Math.max(0, finite(outcome.actualMs)) / 1000;
    if (['partial', 'completed'].includes(normalized) || productiveSeconds > 0) {
      protocolInputs.push({
        ...base,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished,
        eventKey: `${eventKey}:finished`,
        occurredAt: outcomeAt,
        payload: {
          ...payload,
          productiveSeconds,
          committedSeconds: Math.max(0, finite(outcome.committedMs)) / 1000,
        },
      });
    }

    if (normalized === 'completed') {
      protocolInputs.push({
        ...base,
        type: TASK_RECOMMENDER_EVENT_TYPES.taskRecordedComplete,
        eventKey: `${eventKey}:completed`,
        occurredAt: outcomeAt,
        payload: {
          ...payload,
          completedTaskUUID: outcome.completedTaskUUID || event.completedTaskUUID || event.taskUUID,
          completionEventUUID: outcome.completionEventUUID || event.completionEventUUID || null,
        },
      });
    }
  });

  return protocolInputs;
}

function manualChoiceInputs(event) {
  if (!event.recommendationEventId) return [];
  return [{
    playerUUID: String(event.parent),
    decisionUUID: String(event.recommendationEventId),
    type: TASK_RECOMMENDER_EVENT_TYPES.manualAlternativeSelected,
    eventKey: `v11:manual:${event.UUID}`,
    occurredAt: iso(event.createdAt || event.outcomeAt),
    source: event.source || 'tasks',
    taskUUID: event.taskUUID || null,
    origin: 'offline-v11-migration',
    payload: {
      legacySourceUUID: String(event.UUID),
      selectedTaskUUID: event.taskUUID || null,
      comparedTaskUUID: event.metadata?.comparedRecommendationTaskUUID || null,
      projectId: event.metadata?.projectId || null,
      rawOutcome: event.outcome || null,
    },
  }];
}

function migratedV12Settings(records) {
  const settings = records.find((record) => String(record?.UUID || '') === TASK_RECOMMENDER_V11_SETTINGS_ID)?.value || {};
  return Object.freeze({
    schemaVersion: 2,
    continuousTraining: settings.continuousTraining !== false,
    minimumResolvedDecisionsBeforeTraining: Math.max(
      1,
      Math.min(500, Math.floor(finite(settings.minimumEventsBeforeTraining, 8))),
    ),
  });
}

function validateLegacySettings(records) {
  const issues = [];
  for (const record of records) {
    const id = String(record?.UUID || '');
    if (!isTaskRecommenderV11SettingRecord(record)) continue;
    if (id.startsWith(TASK_RECOMMENDER_V11_WEIGHTS_PREFIX)) {
      const model = record?.value || record;
      const version = Number(model?.modelVersion);
      if (!Number.isFinite(version) || version !== 11) {
        issues.push({
          code: 'unsupported-v11-model-version',
          recordUUID: id,
          detail: Number.isFinite(version) ? String(version) : 'missing',
        });
      }
    }
  }
  return issues;
}

export function readTaskRecommenderV11Records({
  playerUUID,
  appSettings = [],
  recommendationEvents = [],
} = {}) {
  const owner = String(playerUUID || '').trim();
  if (!owner) throw new TypeError('Offline v11 migration requires playerUUID');
  const settings = (appSettings || []).filter((record) => {
    if (!isTaskRecommenderV11SettingRecord(record)) return false;
    return !record.parent || String(record.parent) === owner
      || String(record.UUID) === TASK_RECOMMENDER_V11_SETTINGS_ID
      || String(record.UUID) === TASK_RECOMMENDER_V11_WEIGHTS_PREFIX;
  });
  const legacyEvents = (recommendationEvents || []).filter((event) => (
    event
    && event.protocolFamily !== 'task-recommender-v12'
    && (!event.parent || String(event.parent) === owner)
  ));
  const issues = validateLegacySettings(settings);
  const protocolInputs = [];

  for (const event of legacyEvents) {
    if (!event.UUID || !event.parent) {
      issues.push({ code: 'corrupt-v11-event-identity', recordUUID: event.UUID || null });
      continue;
    }
    if (event.type === 'next-task-impression') {
      const duration = Number(
        event.taskSnapshot?.requiredTimerMinutes
        ?? event.taskSnapshot?.suggestedMinutes
        ?? event.suggestedMinutes,
      );
      if (!event.taskUUID || !event.taskSnapshot || !Number.isFinite(duration) || duration <= 0) {
        issues.push({ code: 'corrupt-v11-recommendation', recordUUID: String(event.UUID) });
        continue;
      }
      protocolInputs.push(...recommendationInputs(event));
      continue;
    }
    if (event.type === 'manual-choice') {
      if (!event.recommendationEventId) {
        issues.push({ code: 'corrupt-v11-manual-choice', recordUUID: String(event.UUID) });
        continue;
      }
      protocolInputs.push(...manualChoiceInputs(event));
      continue;
    }
    issues.push({
      code: 'unsupported-v11-event-type',
      recordUUID: String(event.UUID),
      detail: String(event.type || 'missing'),
    });
  }

  return Object.freeze({
    readerVersion: TASK_RECOMMENDER_V11_OFFLINE_READER_VERSION,
    playerUUID: owner,
    hasLegacyArtifacts: settings.length > 0 || legacyEvents.length > 0,
    settings: Object.freeze(settings.map(clone)),
    legacyEvents: Object.freeze(legacyEvents.map(clone)),
    protocolInputs: Object.freeze(protocolInputs.map((input) => Object.freeze(input))),
    v12Settings: migratedV12Settings(settings),
    discard: Object.freeze({
      appSettingUUIDs: Object.freeze(settings.map((record) => String(record.UUID))),
      recommendationEventUUIDs: Object.freeze(legacyEvents.map((event) => String(event.UUID))),
    }),
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
}
