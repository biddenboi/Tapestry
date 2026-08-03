import { v4 as uuid } from 'uuid';
import { GAME_STATE, MINUTE, STORES } from '@domain/constants.js';
import { buildActionReward } from '@domain/rewards/RewardSchedule.js';
import { getTimeBasedTaskPoints } from '@domain/tasks/Tasks.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { queueTaskCompletionSecondaryProcessing } from './TaskCompletionProcessors.js';
import { advanceRecurringTodo } from '@domain/tasks/TaskRecurrence.js';
import { DEFAULT_WORKSPACE_ID } from '@domain/planning/WorkspacePlanningScope.js';

export const TASK_COMPLETION_EVENT_TYPE = 'task-completed';
export const TASK_COMPLETION_EVENT_VERSION = 1;

export function taskOccurrenceKey(task = {}) {
  const scheduled = task.dueDate
    || task.dueAt
    || task.scheduledFor
    || task.createdAt
    || 'unscheduled';
  return `repetition:${String(task.UUID || 'unknown')}:${String(scheduled)}`;
}

function cleanTaskRecord(task) {
  const clean = { ...task };
  [
    'dueDateObj', 'dueKey', 'dueState', 'isOverdue', 'isToday', 'slope',
    'slopeTier', 'projectName', 'projectColor', 'wpd', 'ageDays', 'weight',
    'recommendation',
  ].forEach((key) => delete clean[key]);
  return clean;
}

function asDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function positiveMs(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Math.max(0, Number(fallback) || 0);
}

/**
 * Canonical task-completion transaction.
 *
 * This function owns the complete task record, immediate player reward,
 * required todo/player state changes, and the single authoritative completion
 * event. All contribution, achievement, pass, dojo, and recommender work
 * is delegated to recoverable secondary processors.
 */
export async function completeTask({
  databaseConnection,
  task: sourceTask,
  player: providedPlayer = null,
  gameState = GAME_STATE.idle,
  dojoSessionUUID = null,
  source = gameState,
  completionMode = 'timed',
  startedAt = null,
  completedAt: completedAtInput = null,
  committedMs: committedMsInput = 0,
  actualDurationMs: actualDurationInput = 0,
  removeTodo = false,
  emitRewardEvent = null,
  notify = null,
  playSound = null,
  processSecondary = true,
  actionSessionUUID = null,
  operationId: requestedOperationId = null,
  origin = 'desktop',
  enqueueSync = true,
} = {}) {
  if (!databaseConnection || !sourceTask?.UUID) return null;
  let player = providedPlayer?.UUID
    ? providedPlayer
    : await databaseConnection.getCurrentPlayer();
  let actionSession = null;
  if (actionSessionUUID) {
    actionSession = await databaseConnection.get(STORES.actionSession, actionSessionUUID);
    if (!actionSession) {
      const error = new Error('The Action Session for this completion could not be found.');
      error.code = 'action-session-missing';
      throw error;
    }
    const targetUUID = sourceTask.todoUUID || sourceTask.UUID;
    if (String(actionSession.targetUUID || '') !== String(targetUUID || '')) {
      const error = new Error('This task does not belong to the active Action Session.');
      error.code = 'action-session-target-mismatch';
      throw error;
    }
    if (String(player?.UUID || '') !== String(actionSession.parent || '')) {
      player = await databaseConnection.get(STORES.player, actionSession.parent);
    }
  }
  if (!player?.UUID) return null;
  if (actionSession && String(player.UUID) !== String(actionSession.parent)) {
    const error = new Error('The profile pinned to this Action Session is unavailable.');
    error.code = 'action-session-profile-unavailable';
    throw error;
  }

  const effectiveGameState = actionSession?.matchUUID
    ? GAME_STATE.match
    : actionSession?.dojoSessionUUID
      ? GAME_STATE.dojo
      : gameState;
  const effectiveDojoSessionUUID = effectiveGameState === GAME_STATE.dojo
    ? actionSession?.dojoSessionUUID || dojoSessionUUID || null
    : null;
  const effectiveSource = actionSession?.matchUUID
    ? 'match'
    : actionSession?.dojoSessionUUID
      ? 'shared'
      : source;

  const completedAt = asDate(completedAtInput, new Date());
  const immediate = completionMode === 'immediate';
  // Checking a task off without running a timer records completion, not
  // invented active time. Only measured active milliseconds create Points.
  const actualDurationMs = immediate
    ? 0
    : positiveMs(
      actualDurationInput,
      completedAt.getTime() - asDate(startedAt || sourceTask.createdAt, completedAt).getTime(),
    );
  const committedMs = immediate
    ? actualDurationMs
    : positiveMs(committedMsInput, 0);
  const createdAt = immediate
    ? new Date(completedAt.getTime() - actualDurationMs)
    : asDate(startedAt || sourceTask.createdAt, new Date(completedAt.getTime() - actualDurationMs));

  const viewerIGT = getCurrentIGT(player);
  const pointReward = getTimeBasedTaskPoints(actualDurationMs);
  const points = pointReward.points;

  const operationId = requestedOperationId || uuid();
  const completionEventUUID = `task-completion-event:${operationId}`;
  const occurrenceKey = taskOccurrenceKey(sourceTask);
  const completedTask = {
    ...cleanTaskRecord(sourceTask),
    UUID: `completed-task:${operationId}`,
    todoUUID: sourceTask.todoUUID || sourceTask.UUID,
    parent: player.UUID,
    workspaceId: sourceTask.workspaceId || DEFAULT_WORKSPACE_ID,
    createdAt: createdAt.toISOString(),
    completedAt: completedAt.toISOString(),
    inGameTimestamp: viewerIGT,
    completedInGameTimestamp: viewerIGT,
    source: effectiveSource,
    dojoSessionUUID: effectiveDojoSessionUUID,
    sessionDuration: committedMs || actualDurationMs,
    points,
    pointsBase: pointReward.basePoints,
    pointsRandomFactor: pointReward.randomFactor,
    completionEventUUID,
    operationId,
    occurrenceKey,
    actionSessionUUID,
  };
  if (completedTask.projectId) {
    const goal = await databaseConnection.get(STORES.project, completedTask.projectId);
    completedTask.goalName = goal?.name || sourceTask.goalName || sourceTask.projectName || null;
  }

  const reward = buildActionReward({
    actionType: 'task',
    seed: completedTask.UUID,
    baseCoins: 0,
  });
  const tokensGained = Number(reward.coins) || 0;
  completedTask.rewardBaseCoins = 0;
  completedTask.rewardBonusCoins = tokensGained;
  completedTask.rewardBand = reward.bandId;
  completedTask.rewardRarity = reward.rarity;

  // A timed session records the work that actually occurred. The commitment
  // remains a separate comparison fact and must not inflate cleared minutes.
  const minutesCleared = actualDurationMs / MINUTE;
  const updatedPlayer = {
    ...player,
    tokens: Math.floor((player.tokens || 0) + tokensGained),
    minutesClearedToday: (player.minutesClearedToday || 0) + minutesCleared,
  };
  const recommendationEventId = sourceTask.taskRecommendationEventId
    || sourceTask.recommendation?.eventUUID
    || null;
  const completionEvent = {
    UUID: completionEventUUID,
    parent: player.UUID,
    type: TASK_COMPLETION_EVENT_TYPE,
    eventSchemaVersion: TASK_COMPLETION_EVENT_VERSION,
    taskUUID: completedTask.UUID,
    actionSessionUUID,
    todoUUID: completedTask.todoUUID,
    operationId,
    occurrenceKey,
    gameState: effectiveGameState,
    source: effectiveSource,
    completedAt: completedTask.completedAt,
    createdAt: completedTask.completedAt,
    durationMs: actualDurationMs,
    durationEvidence: immediate
      ? 'estimated-immediate'
      : actionSessionUUID
        ? 'action-session'
        : startedAt
          ? 'explicit-start'
          : 'fallback',
    committedMs,
    pointsBase: pointReward.basePoints,
    pointsRandomFactor: pointReward.randomFactor,
    reward: {
      coins: tokensGained,
      contribution: Number(reward.contribution) || 0,
      bandId: reward.bandId || null,
      rarity: reward.rarity || null,
      label: reward.label || null,
    },
    recommendation: recommendationEventId ? {
      eventUUID: recommendationEventId,
      suggestedMinutes: Number(sourceTask.recommendation?.suggestedMinutes || sourceTask.estimatedDuration || 0),
      acceptedMinutes: (committedMs || actualDurationMs) / MINUTE,
      completed: committedMs <= 0 || actualDurationMs >= committedMs,
    } : null,
  };

  const puts = [
    { store: STORES.player, record: updatedPlayer },
    { store: STORES.task, record: completedTask },
  ];
  const deletes = [];
  let nextOccurrence = null;
  if (removeTodo) {
    nextOccurrence = advanceRecurringTodo(cleanTaskRecord(sourceTask), completedAt);
    if (nextOccurrence) puts.push({ store: STORES.todo, record: nextOccurrence });
    else deletes.push({ store: STORES.todo, UUID: sourceTask.UUID });
  }
  // The immutable completion event is the commit marker and shares the same
  // SQLite transaction as recurrence advancement and immediate rewards.
  puts.push({ store: STORES.taskCompletionEvent, record: completionEvent });
  const sync = databaseConnection.createSyncCommandContext?.({
    origin,
    enqueueSync,
    operationId,
      playerId: player.UUID,
      workspaceId: completedTask.workspaceId,
    commandType: 'completeTaskOccurrence',
    entityType: 'task-occurrence',
    entityId: occurrenceKey,
    payload: {
      taskId: sourceTask.UUID,
      occurrenceKey,
      completedAt: completedTask.completedAt,
      completionMode,
      actualDurationMs,
      committedMs,
      gameState: effectiveGameState,
      actionSessionUUID,
      updatedPlayer,
      completedTask,
      completionEvent,
      removeTodo,
      nextOccurrence,
    },
    occurredAt: completedTask.completedAt,
  }) || { origin, enqueueSync: false };
  const commit = await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'task-occurrence-complete',
    puts,
    deletes,
    sync,
  });

  if (commit?.duplicate) {
    const [persistedTask, persistedEvent, persistedPlayer] = await Promise.all([
      databaseConnection.get(STORES.task, completedTask.UUID),
      databaseConnection.get(STORES.taskCompletionEvent, completionEvent.UUID),
      databaseConnection.get(STORES.player, player.UUID),
    ]);
    return {
      completionEvent: persistedEvent || completionEvent,
      completedTask: persistedTask || completedTask,
      updatedPlayer: persistedPlayer || updatedPlayer,
      duration: actualDurationMs,
      committedMs,
      pointsBase: pointReward.basePoints,
      pointsRandomFactor: pointReward.randomFactor,
      tokensGained,
      reward,
      duplicate: true,
      operationId,
      occurrenceKey,
    };
  }

  if (tokensGained > 0) playSound?.('roll', { volume: 0.72, throttleMs: 400 });
  emitRewardEvent?.([
    { amount: completedTask.points, unit: 'points', kind: 'points' },
    { amount: tokensGained, unit: 'coins', kind: 'coins' },
  ], { source: 'task-results', completionEventUUID });

  if (processSecondary) {
    queueTaskCompletionSecondaryProcessing(databaseConnection, completionEvent, {
      task: completedTask,
      player: updatedPlayer,
      reward,
      notify,
      emitRewardEvent,
    });
  }

  return {
    completionEvent,
    completedTask,
    updatedPlayer,
    duration: actualDurationMs,
    committedMs,
    pointsBase: pointReward.basePoints,
    pointsRandomFactor: pointReward.randomFactor,
    tokensGained,
    reward,
    duplicate: false,
    operationId,
    occurrenceKey,
  };
}

export default completeTask;
