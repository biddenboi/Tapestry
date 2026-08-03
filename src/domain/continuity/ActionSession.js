import { v4 as uuid } from 'uuid';
import { MINUTE, STORES } from '@domain/constants.js';
import { getTimeBasedTaskPoints } from '@domain/tasks/Tasks.js';
import { createRewardProvenance } from '@domain/rewards/RewardProvenance.js';
import { createWorldConsequenceReceipt } from '@domain/world-consequences/WorldConsequencePolicy.js';
import { createHandoff, HANDOFF_STATUS } from './Handoff.js';
import { createMatchScoreEvent } from '@domain/matches/MatchScoring.js';
import { calculateMatchPromiseScore } from '@domain/matches/MatchPromiseReward.js';

export const ACTION_SESSION_OUTCOME = Object.freeze({
  active: 'active',
  completed: 'completed',
  progressed: 'progressed',
  blocked: 'blocked',
  stopped: 'stopped',
});

export const ACTION_SESSION_BLOCKER = Object.freeze({
  person: 'waiting-on-person',
  information: 'missing-information',
  technical: 'technical-problem',
  unclear: 'next-step-unclear',
  environment: 'environment-unavailable',
  irrelevant: 'no-longer-relevant',
  other: 'other',
});

const ALLOWED_SOURCES = new Set([
  'arrival',
  'recommender',
  'manual',
  'notification',
  'shared',
  'match',
]);

function asISO(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function boundedText(value, limit) {
  return String(value || '').trim().slice(0, limit) || null;
}

function sessionElapsed(record, at = Date.now()) {
  const stored = Math.max(0, Number(record?.activeDurationMs) || 0);
  if (!record?.activeAnchorAt || record.outcome !== ACTION_SESSION_OUTCOME.active) return stored;
  const anchor = new Date(record.activeAnchorAt).getTime();
  return stored + (Number.isFinite(anchor) ? Math.max(0, Number(at) - anchor) : 0);
}

function deterministicCoinAmount(sessionUUID, outcome, activeDurationMs) {
  if (outcome === ACTION_SESSION_OUTCOME.progressed && activeDurationMs >= MINUTE) {
    let hash = 2166136261;
    for (const character of String(sessionUUID)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return 2 + ((hash >>> 0) % 3);
  }
  if (outcome === ACTION_SESSION_OUTCOME.blocked && activeDurationMs >= 10 * MINUTE) return 1;
  return 0;
}

function effortIsAccepted(outcome, activeDurationMs) {
  if (outcome === ACTION_SESSION_OUTCOME.completed) return activeDurationMs > 0;
  if (outcome === ACTION_SESSION_OUTCOME.progressed) return activeDurationMs >= MINUTE;
  if (outcome === ACTION_SESSION_OUTCOME.blocked) return activeDurationMs >= MINUTE;
  return outcome === ACTION_SESSION_OUTCOME.stopped && activeDurationMs >= 5 * MINUTE;
}

export function createActionSession({
  playerUUID,
  task,
  goalUUID = task?.projectId || null,
  milestoneUUID = task?.milestoneUUID || null,
  matchUUID = null,
  dojoSessionUUID = null,
  source = 'manual',
  startedAt = new Date().toISOString(),
  matchRewardContract = task?.matchRewardContract || null,
  controllingDeviceId = null,
  UUID = uuid(),
} = {}) {
  if (!playerUUID || !task?.UUID) throw new TypeError('An Action Session requires a player and target.');
  const timestamp = asISO(startedAt);
  return Object.freeze({
    UUID,
    parent: String(playerUUID),
    targetType: task.targetType || 'todo',
    targetUUID: String(task.UUID),
    targetName: boundedText(task.name || 'Untitled task', 300),
    goalUUID: goalUUID || null,
    milestoneUUID: milestoneUUID || null,
    matchUUID: matchUUID || null,
    matchRewardContract: matchUUID && matchRewardContract ? { ...matchRewardContract } : null,
    matchScoreFinalizedAt: null,
    matchScoreEventUUID: null,
    matchScoreBreakdown: null,
    dojoSessionUUID: dojoSessionUUID || null,
    source: ALLOWED_SOURCES.has(source) ? source : 'manual',
    controllingDeviceId: controllingDeviceId ? String(controllingDeviceId) : null,
    controlTakenAt: controllingDeviceId ? timestamp : null,
    startedAt: timestamp,
    endedAt: null,
    committedMs: Math.max(0, Number(task.sessionDuration) || 0),
    activeDurationMs: 0,
    pausedDurationMs: 0,
    activeAnchorAt: timestamp,
    activityIntervals: [{ startsAt: timestamp, endsAt: null }],
    pausedAt: null,
    outcome: ACTION_SESSION_OUTCOME.active,
    blockerType: null,
    nextStep: null,
    outcomeNote: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function getActiveActionSession(databaseConnection, playerUUID) {
  if (!playerUUID) return null;
  const sessions = await databaseConnection.getPlayerStore(STORES.actionSession, playerUUID);
  return sessions
    .filter((session) => session.outcome === ACTION_SESSION_OUTCOME.active)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0] || null;
}

export async function startActionSession(databaseConnection, input) {
  const current = await getActiveActionSession(databaseConnection, input.playerUUID);
  if (current) {
    if (String(current.targetUUID) === String(input.task?.UUID)) return current;
    const error = new Error('Another action is already active. Close or resume it before beginning a new one.');
    error.code = 'action-session-already-active';
    throw error;
  }
  const requestedOperationId = input.operationId || null;
  const session = createActionSession({
    ...input,
    controllingDeviceId: input.controllingDeviceId
      || databaseConnection.syncRuntime?.device?.id
      || null,
    ...(requestedOperationId && !input.UUID
      ? { UUID: `action-session:${requestedOperationId}` }
      : {}),
  });
  const operationId = requestedOperationId || `action-session-start:${session.UUID}`;
  const existingTodo = await databaseConnection.get(STORES.todo, input.task.UUID);
  const taskRecord = existingTodo ? null : {
    ...input.task,
    UUID: input.task.UUID,
    parent: input.playerUUID,
    createdAt: input.task.todoCreatedAt || input.task.createdAt || session.startedAt,
    updatedAt: session.startedAt,
  };
  if (taskRecord) {
    delete taskRecord.sessionDuration;
    delete taskRecord.presencePaused;
  }
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'action-session-start',
    puts: [
      taskRecord ? { store: STORES.todo, record: taskRecord } : null,
      { store: STORES.actionSession, record: session },
    ].filter(Boolean),
    sync: databaseConnection.createSyncCommandContext?.({
      origin: input.origin || 'desktop',
      enqueueSync: input.enqueueSync !== false,
      operationId,
      playerId: input.playerUUID,
      commandType: 'startActionSession',
      entityType: 'action-session',
      entityId: session.UUID,
      payload: {
        session,
        task: taskRecord,
      },
      occurredAt: session.startedAt,
    }) || { origin: input.origin || 'desktop', enqueueSync: false },
  });
  return session;
}

export async function pauseActionSession(databaseConnection, sessionUUID, at = new Date(), options = {}) {
  const current = await databaseConnection.get(STORES.actionSession, sessionUUID);
  if (!current || current.outcome !== ACTION_SESSION_OUTCOME.active || current.pausedAt) return current;
  const timestamp = asISO(at);
  const next = {
    ...current,
    activeDurationMs: Math.round(sessionElapsed(current, at.getTime())),
    activeAnchorAt: null,
    pausedAt: timestamp,
    activityIntervals: (current.activityIntervals || [{ startsAt: current.startedAt, endsAt: null }])
      .map((interval, index, intervals) => (
        index === intervals.length - 1 && !interval.endsAt
          ? { ...interval, endsAt: timestamp }
          : interval
      )),
    updatedAt: timestamp,
  };
  const operationId = options.operationId || `action-session-pause:${sessionUUID}:${timestamp}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'action-session-pause',
    puts: [{ store: STORES.actionSession, record: next }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin: options.origin || 'desktop',
      enqueueSync: options.enqueueSync !== false,
      operationId,
      playerId: current.parent,
      commandType: 'pauseActionSession',
      entityType: 'action-session',
      entityId: sessionUUID,
      payload: { pausedAt: timestamp, session: next },
      occurredAt: timestamp,
    }) || { origin: options.origin || 'desktop', enqueueSync: false },
  });
  return next;
}

export async function resumeActionSession(databaseConnection, sessionUUID, at = new Date(), options = {}) {
  const current = await databaseConnection.get(STORES.actionSession, sessionUUID);
  if (!current || current.outcome !== ACTION_SESSION_OUTCOME.active || !current.pausedAt) return current;
  const timestamp = asISO(at);
  const pausedAt = new Date(current.pausedAt).getTime();
  const next = {
    ...current,
    pausedDurationMs: Math.max(0, Number(current.pausedDurationMs) || 0)
      + (Number.isFinite(pausedAt) ? Math.max(0, at.getTime() - pausedAt) : 0),
    activeAnchorAt: timestamp,
    pausedAt: null,
    activityIntervals: [
      ...(current.activityIntervals || []),
      { startsAt: timestamp, endsAt: null },
    ],
    updatedAt: timestamp,
  };
  const operationId = options.operationId || `action-session-resume:${sessionUUID}:${timestamp}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'action-session-resume',
    puts: [{ store: STORES.actionSession, record: next }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin: options.origin || 'desktop',
      enqueueSync: options.enqueueSync !== false,
      operationId,
      playerId: current.parent,
      commandType: 'resumeActionSession',
      entityType: 'action-session',
      entityId: sessionUUID,
      payload: { resumedAt: timestamp, session: next },
      occurredAt: timestamp,
    }) || { origin: options.origin || 'desktop', enqueueSync: false },
  });
  return next;
}

export async function takeOverActionSession(databaseConnection, sessionUUID, {
  deviceId = databaseConnection?.syncRuntime?.device?.id || null,
  at = new Date(),
  operationId: requestedOperationId = null,
  origin = 'desktop',
  enqueueSync = true,
} = {}) {
  if (!deviceId) {
    const error = new Error('This device needs a registered sync identity before taking control.');
    error.code = 'sync-device-unavailable';
    throw error;
  }
  const current = await databaseConnection.get(STORES.actionSession, sessionUUID);
  if (!current || current.outcome !== ACTION_SESSION_OUTCOME.active) return current;
  if (String(current.controllingDeviceId || '') === String(deviceId)) return current;
  const controlTakenAt = asISO(at);
  const next = {
    ...current,
    controllingDeviceId: String(deviceId),
    controlTakenAt,
    updatedAt: controlTakenAt,
  };
  const operationId = requestedOperationId || `action-session-takeover:${sessionUUID}:${controlTakenAt}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'action-session-takeover',
    puts: [{ store: STORES.actionSession, record: next }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId,
      playerId: current.parent,
      commandType: 'takeOverActionSession',
      entityType: 'action-session',
      entityId: sessionUUID,
      payload: { controllingDeviceId: String(deviceId), controlTakenAt, session: next },
      occurredAt: controlTakenAt,
    }) || { origin, enqueueSync: false },
  });
  return next;
}

function buildContribution(session, amount, outcome, at) {
  if (!amount) return null;
  return {
    UUID: `action-contribution:task-session:${session.parent}:${session.UUID}`,
    parent: session.parent,
    goalUUID: session.goalUUID,
    taskUUID: null,
    todoUUID: session.targetUUID,
    completionEventUUID: null,
    source: 'task-session',
    direction: 'positive',
    summary: `${outcome === 'blocked' ? 'Blocked work' : 'Progressed work'}: ${session.targetName || 'Action session'}`,
    taskName: session.targetName || 'Action session',
    value: amount,
    rewardBand: 'continuity-fixed',
    rewardRarity: 'none',
    rewardCoins: 0,
    playerNameSnapshot: null,
    goalNameSnapshot: null,
    createdAt: at,
    completedAt: at,
  };
}

function buildGoalUpdate(session, outcome, at, note, nextStep) {
  if (!session.goalUUID || outcome === ACTION_SESSION_OUTCOME.stopped) return null;
  return {
    UUID: `goal-update:action-session:${session.UUID}`,
    parent: session.parent,
    goalUUID: session.goalUUID,
    kind: outcome === ACTION_SESSION_OUTCOME.blocked ? 'blocker' : 'session-evidence',
    summary: boundedText(
      note
        || nextStep
        || `${session.targetName || 'Action'} ${outcome}.`,
      500,
    ),
    healthStatusSnapshot: outcome === ACTION_SESSION_OUTCOME.blocked ? 'at_risk' : null,
    lifecycleStatusSnapshot: 'active',
    sourceType: 'action-session',
    sourceUUID: session.UUID,
    createdAt: at,
  };
}

function buildDaybookEvent(session, outcome, activeDurationMs, at) {
  return {
    UUID: `continuity-event:${session.UUID}`,
    parent: session.parent,
    type: 'action-session',
    description: `${session.targetName || 'Action'} · ${outcome} · ${Math.round(activeDurationMs / MINUTE)}m active`,
    sourceSessionUUID: session.UUID,
    outcome,
    activeDurationMs,
    createdAt: at,
  };
}

export async function settleActionSession(databaseConnection, {
  sessionUUID,
  player,
  outcome,
  blockerType = null,
  nextStep = null,
  outcomeNote = null,
  endedAt = new Date(),
  activeDurationMs = null,
  primaryTaskResult = null,
  match = null,
  operationId: requestedOperationId = null,
  origin = 'desktop',
  enqueueSync = true,
} = {}) {
  if (!databaseConnection || !sessionUUID) return null;
  if (!Object.values(ACTION_SESSION_OUTCOME).includes(outcome) || outcome === ACTION_SESSION_OUTCOME.active) {
    throw new TypeError(`Unsupported action session outcome: ${outcome}`);
  }
  const current = await databaseConnection.get(STORES.actionSession, sessionUUID);
  if (!current) throw new Error('The active Action Session could not be found.');
  if (current.outcome !== ACTION_SESSION_OUTCOME.active) {
    return {
      session: current,
      duplicate: true,
      points: Number(current.points) || 0,
      coins: Number(current.coins) || 0,
      contribution: Number(current.contributionValue) || 0,
    };
  }
  if (String(player?.UUID || '') !== String(current.parent || '')) {
    player = await databaseConnection.get(STORES.player, current.parent);
  }
  if (!player?.UUID || String(player.UUID) !== String(current.parent)) {
    const error = new Error('The profile pinned to this Action Session is unavailable.');
    error.code = 'action-session-profile-unavailable';
    throw error;
  }
  if (
    primaryTaskResult
    && (
      String(primaryTaskResult.completedTask?.parent || '') !== String(current.parent)
      || String(primaryTaskResult.updatedPlayer?.UUID || '') !== String(current.parent)
    )
  ) {
    const error = new Error('Task completion ownership does not match the Action Session profile.');
    error.code = 'action-session-profile-mismatch';
    throw error;
  }
  const endedAtDate = endedAt instanceof Date ? endedAt : new Date(endedAt);
  const at = asISO(endedAtDate);
  const duration = Math.max(
    0,
    activeDurationMs == null
      ? sessionElapsed(current, endedAtDate.getTime())
      : Number(activeDurationMs) || 0,
  );
  const acceptedEffort = effortIsAccepted(outcome, duration);
  const calculatedPoints = acceptedEffort
    ? getTimeBasedTaskPoints(duration, `${current.UUID}:${outcome}`).points
    : 0;
  const points = primaryTaskResult?.completedTask
    ? Math.max(0, Math.floor(Number(primaryTaskResult.completedTask.points) || 0))
    : calculatedPoints;
  const coins = primaryTaskResult
    ? Math.max(0, Number(primaryTaskResult.tokensGained) || 0)
    : deterministicCoinAmount(current.UUID, outcome, duration);
  const contributionValue = primaryTaskResult
    ? Math.max(0, Number(primaryTaskResult.reward?.contribution) || 0)
    : outcome === ACTION_SESSION_OUTCOME.progressed && acceptedEffort
      ? 2
      : outcome === ACTION_SESSION_OUTCOME.blocked && duration >= 5 * MINUTE
        ? 1
        : 0;
  let session = {
    ...current,
    endedAt: at,
    activeDurationMs: Math.round(duration),
    activeAnchorAt: null,
    pausedAt: null,
    activityIntervals: (current.activityIntervals || [{ startsAt: current.startedAt, endsAt: null }])
      .map((interval, index, intervals) => (
        index === intervals.length - 1 && !interval.endsAt
          ? { ...interval, endsAt: at }
          : interval
      )),
    outcome,
    blockerType: outcome === ACTION_SESSION_OUTCOME.blocked
      ? boundedText(blockerType || ACTION_SESSION_BLOCKER.other, 80)
      : null,
    nextStep: boundedText(nextStep, 500),
    outcomeNote: boundedText(outcomeNote, 1200),
    points,
    coins,
    contributionValue,
    taskCompletionEventUUID: primaryTaskResult?.completionEvent?.UUID || null,
    updatedAt: at,
  };
  const contribution = primaryTaskResult
    ? null
    : buildContribution(session, contributionValue, outcome, at);
  const updatedPlayer = primaryTaskResult
    ? null
    : {
        ...player,
        tokens: Math.max(0, Number(player.tokens) || 0) + coins,
        minutesClearedToday: Math.max(0, Number(player.minutesClearedToday) || 0) + duration / MINUTE,
      };
  const updatedTodo = outcome === ACTION_SESSION_OUTCOME.completed
    ? null
    : await databaseConnection.get(STORES.todo, session.targetUUID);
  const todoPatch = updatedTodo ? {
    ...updatedTodo,
    nextStep: session.nextStep || updatedTodo.nextStep || null,
    blocker: outcome === ACTION_SESSION_OUTCOME.blocked
      ? { type: session.blockerType, note: session.outcomeNote, createdAt: at }
      : outcome === ACTION_SESSION_OUTCOME.progressed
        ? null
        : updatedTodo.blocker || null,
    updatedAt: at,
  } : null;
  const goalUpdate = buildGoalUpdate(session, outcome, at, session.outcomeNote, session.nextStep);
  const daybookEvent = buildDaybookEvent(session, outcome, duration, at);
  const worldReceipt = points > 0 ? createWorldConsequenceReceipt({
    playerUUID: player.UUID,
    sourceEventUUID: session.UUID,
    sourceType: 'action-session',
    payload: {
      outcome,
      targetUUID: session.targetUUID,
      targetName: session.targetName,
      goalUUID: session.goalUUID,
      activeDurationMs: duration,
    },
    createdAt: at,
  }) : null;
  const handoff = [ACTION_SESSION_OUTCOME.progressed, ACTION_SESSION_OUTCOME.blocked].includes(outcome)
    && (session.nextStep || session.outcomeNote)
    ? createHandoff({
        playerUUID: player.UUID,
        sourceSessionUUID: session.UUID,
        resumeTargetType: session.targetType,
        resumeTargetUUID: session.targetUUID,
        goalUUID: session.goalUUID,
        milestoneUUID: session.milestoneUUID,
        nextStep: session.nextStep,
        unresolvedContext: session.outcomeNote,
        generatedSummary: `${session.targetName || 'Action'} is ready to resume.`,
        createdAt: at,
      })
    : null;
  const resolvedMatch = match || (session.matchUUID
    ? await databaseConnection.get(STORES.match, session.matchUUID)
    : null);
  let scoreEvent = null;
  if (resolvedMatch?.status === 'active' && !current.matchScoreFinalizedAt) {
    const scoreBreakdown = current.matchRewardContract
      ? calculateMatchPromiseScore({
          contract: current.matchRewardContract,
          activeDurationMs: duration,
          boundaryAt: at,
        })
      : {
          policyId: 'legacy-time-only',
          policyVersion: 0,
          boundaryAt: at,
          eligibleActiveMs: duration,
          basePoints: points,
          taskMultiplier: 1,
          eventMultiplier: 1,
          promisedMs: 0,
          promiseRatio: 0,
          promiseMet: false,
          promiseScalar: 1,
          totalMultiplier: 1,
          points,
        };
    scoreEvent = createMatchScoreEvent({
      match: resolvedMatch,
      participantUUID: player.UUID,
      actionSession: session,
      taskCompletionEventUUID: session.taskCompletionEventUUID,
      points: scoreBreakdown?.points || 0,
      scoreBreakdown,
      occurredAt: at,
    });
    session = {
      ...session,
      matchScoreFinalizedAt: at,
      matchScoreEventUUID: scoreEvent?.UUID || null,
      matchScoreBreakdown: scoreBreakdown,
    };
  }
  const provenance = [
    points > 0 ? createRewardProvenance({
      playerUUID: player.UUID,
      sourceEventUUID: session.UUID,
      sourceType: 'action-session',
      rewardType: 'points',
      amount: points,
      explanation: `${Math.round(duration / MINUTE)} minutes of accepted active work (${outcome}).`,
      issuedAt: at,
    }) : null,
    coins > 0 ? createRewardProvenance({
      playerUUID: player.UUID,
      sourceEventUUID: session.UUID,
      sourceType: 'action-session',
      rewardType: 'coins',
      amount: coins,
      explanation: outcome === ACTION_SESSION_OUTCOME.blocked
        ? 'Limited blocked-session coin policy; range 0–1.'
        : 'Eligible session coin policy; disclosed range 2–4.',
      issuedAt: at,
    }) : null,
    contribution ? createRewardProvenance({
      playerUUID: player.UUID,
      sourceEventUUID: session.UUID,
      sourceType: 'action-session',
      rewardType: 'contribution',
      amount: contributionValue,
      explanation: `${outcome} task effort settled under the continuity policy.`,
      issuedAt: at,
    }) : null,
  ].filter(Boolean);
  const existingHandoffs = handoff
    ? await databaseConnection.getPlayerStore(STORES.handoff, player.UUID)
    : [];
  const handoffPuts = handoff ? [
    ...existingHandoffs
      .filter((row) => row.status === HANDOFF_STATUS.active && row.UUID !== handoff.UUID)
      .map((row) => ({
        store: STORES.handoff,
        record: {
          ...row,
          status: HANDOFF_STATUS.superseded,
          updatedAt: at,
        },
      })),
    { store: STORES.handoff, record: handoff },
  ] : [];
  const puts = [
    { store: STORES.actionSession, record: session },
    updatedPlayer ? { store: STORES.player, record: updatedPlayer } : null,
    todoPatch ? { store: STORES.todo, record: todoPatch } : null,
    contribution ? { store: STORES.contribution, record: contribution } : null,
    goalUpdate ? { store: STORES.goalUpdate, record: goalUpdate } : null,
    { store: STORES.event, record: daybookEvent },
    worldReceipt ? { store: STORES.worldConsequenceReceipt, record: worldReceipt } : null,
    ...handoffPuts,
    scoreEvent ? { store: STORES.matchScoreEvent, record: scoreEvent } : null,
    ...provenance.map((record) => ({ store: STORES.rewardProvenance, record })),
  ].filter(Boolean);
  const operationId = requestedOperationId || `action-session-settle:${sessionUUID}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: `action-session-settle:${outcome}`,
    puts,
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId,
      playerId: player.UUID,
      commandType: 'finalizeActionSession',
      entityType: 'action-session',
      entityId: sessionUUID,
      payload: {
        outcome,
        blockerType: session.blockerType,
        nextStep: session.nextStep,
        outcomeNote: session.outcomeNote,
        endedAt: at,
        activeDurationMs: duration,
        matchScoreEventId: scoreEvent?.UUID || null,
        session,
        player: updatedPlayer || primaryTaskResult?.updatedPlayer || null,
        todo: todoPatch,
        contribution,
        goalUpdate,
        daybookEvent,
        worldReceipt,
        handoffRecords: handoffPuts.map(({ record }) => record),
        scoreEvent,
        provenance,
      },
      occurredAt: at,
    }) || { origin, enqueueSync: false },
  });
  return Object.freeze({
    session,
    player: updatedPlayer || primaryTaskResult?.updatedPlayer || player,
    points,
    coins,
    contribution: contributionValue,
    reward: primaryTaskResult?.reward || {
      bandId: 'continuity-fixed',
      label: coins ? 'Standard' : 'No coin award',
      rarity: 'none',
      coins,
      contribution: contributionValue,
      reel: [],
    },
    goalUpdate,
    daybookEvent,
    worldReceipt,
    handoff,
    scoreEvent,
    provenance,
    integration: {
      effort: {
        activeDurationMs: duration,
        points,
        contribution: contributionValue,
        coins,
      },
      goal: goalUpdate ? {
        goalUUID: session.goalUUID,
        summary: goalUpdate.summary,
      } : null,
      match: scoreEvent ? {
        matchUUID: scoreEvent.matchUUID,
        points: scoreEvent.points,
        rule: scoreEvent.eligibleRuleId,
      } : null,
      history: 'Session saved to Daybook',
      world: worldReceipt ? {
        receiptUUID: worldReceipt.UUID,
        consequenceType: worldReceipt.consequenceType,
      } : null,
    },
  });
}

export { sessionElapsed as actionSessionElapsed };
