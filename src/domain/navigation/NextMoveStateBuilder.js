import { STORES } from '../constants.js';
import { buildTaskRecommenderRecommendation } from '../tasks/TaskRecommender.js';
import { taskPriorityClass } from './NextMovePolicyV1.js';
import { materialStateKey } from './NextMoveInvalidation.js';
import {
  buildTaskClarificationCandidate,
  normalizeTaskPlanningMetadata,
  taskIsExecutableNow,
} from '../planning/TaskPlanningEligibility.js';
import { isTaskPlanReceiptValid } from '../planning/TaskPlanReceipt.js';
import { evaluateDayOrientationNeed } from '../planning/DayOrientationNeed.js';
import { evaluateGoalDirectionNeed } from '../planning/GoalDirectionNeed.js';
import { NEXT_MOVE_REASON } from './NextMoveReasonCodes.js';

const MINUTE = 60 * 1000;

function safeTime(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : null;
}

function effectiveReminderTime(reminder) {
  return safeTime(reminder.snoozedUntil || reminder.remindAt || reminder.startAt);
}

function upcomingCommitment(reminders, nowMs) {
  return reminders
    .filter((item) => !item.completedAt && !item.dismissedAt && item.fixedCommitment !== false)
    .map((item) => {
      const startsAt = effectiveReminderTime(item);
      const prepMs = Math.max(0, Number(item.preparationMinutes ?? item.travelMinutes ?? 3) * MINUTE);
      return { item, startsAt, transitionAt: startsAt == null ? null : startsAt - prepMs };
    })
    .filter((entry) => (
      entry.startsAt != null
      && entry.startsAt >= nowMs
      && entry.transitionAt <= nowMs
    ))
    .sort((a, b) => a.startsAt - b.startsAt)[0] || null;
}

function nextFixedStart(reminders, nowMs) {
  return reminders
    .map(effectiveReminderTime)
    .filter((time) => time != null && time > nowMs)
    .sort((a, b) => a - b)[0] || null;
}

function latestMeaningfulSession(sessions) {
  return [...sessions]
    .filter((session) => (
      session.outcome && session.outcome !== 'active'
      && ['completed', 'progressed', 'blocked', 'stopped'].includes(session.outcome)
    ))
    .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')))[0] || null;
}

async function readPlayerStore(databaseConnection, store, playerUUID) {
  return databaseConnection.getPlayerStore(store, playerUUID).catch(() => []);
}

export async function buildNextMoveState({
  databaseConnection,
  currentPlayer,
  decisionPoint = 'drawer-open',
  activeTaskSession = null,
  activePairMatch = null,
  activeDojoSession = null,
  currentLocationContext = null,
  now = new Date(),
  impossibleSuggestionCount = 0,
} = {}) {
  if (!databaseConnection || !currentPlayer?.UUID) return null;
  const playerUUID = String(currentPlayer.UUID);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const [
    rawTodos,
    receipts,
    handoffs,
    reminders,
    goals,
    milestones,
    sessions,
  ] = await Promise.all([
    readPlayerStore(databaseConnection, STORES.todo, playerUUID),
    readPlayerStore(databaseConnection, STORES.taskPlanReceipt, playerUUID),
    readPlayerStore(databaseConnection, STORES.handoff, playerUUID),
    readPlayerStore(databaseConnection, STORES.reminder, playerUUID),
    readPlayerStore(databaseConnection, STORES.project, playerUUID),
    databaseConnection.getAll(STORES.goalMilestone).catch(() => []),
    readPlayerStore(databaseConnection, STORES.actionSession, playerUUID),
  ]);

  const todos = rawTodos.map(normalizeTaskPlanningMetadata);
  const receiptByTask = new Map(
    receipts
      .filter((receipt) => receipt.status === 'active')
      .map((receipt) => [String(receipt.taskUUID), receipt]),
  );
  const commitment = upcomingCommitment(reminders, nowMs);
  const nextStart = nextFixedStart(reminders, nowMs);
  const availableWindowSeconds = nextStart == null
    ? Infinity
    : Math.max(0, Math.floor((nextStart - nowMs) / 1000));

  const activeHandoff = [...handoffs]
    .filter((handoff) => handoff.status === 'active' && handoff.nextStep)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
  const continuationTask = activeHandoff
    ? todos.find((task) => String(task.UUID) === String(activeHandoff.resumeTargetUUID))
    : null;
  const continuation = continuationTask
    && !continuationTask.completedAt
    && !continuationTask.blockerType
    ? {
        UUID: continuationTask.UUID,
        entityUUID: continuationTask.UUID,
        entityType: 'task',
        title: activeHandoff.nextStep || `Continue ${continuationTask.name}`,
        context: activeHandoff.unresolvedContext || `Resume ${continuationTask.name}.`,
        routeLabel: `Tasks → ${continuationTask.name} → resume`,
        primaryAction: { type: 'resume-task', label: 'Resume' },
        sourceEntityRefs: [
          { type: 'handoff', UUID: activeHandoff.UUID },
          { type: 'task', UUID: continuationTask.UUID },
        ],
        invalidationKeys: [
          materialStateKey('handoff', activeHandoff),
          materialStateKey('task', continuationTask),
        ],
      }
    : null;

  const executableTasks = todos.filter((task) => taskIsExecutableNow(task, {
    receipt: receiptByTask.get(String(task.UUID)),
    availableWindowSeconds,
    currentLocationContext,
  }));
  const urgentTasks = todos.filter((task) => taskPriorityClass(task, now) <= 1);
  const clarification = todos
    .map((task) => buildTaskClarificationCandidate(
      task,
      receiptByTask.get(String(task.UUID)),
      now,
    ))
    .filter(Boolean)
    .sort((a, b) => a.priorityClass - b.priorityClass)[0] || null;

  let recommendation = null;
  const executableSetKey = executableTasks
    .map((task) => materialStateKey('task', task))
    .sort()
    .join('|');
  const recommendationSeed = [
    'next-move-v1',
    playerUUID,
    executableSetKey || 'no-executable-task',
    Number.isFinite(availableWindowSeconds)
      ? `window:${Math.floor(availableWindowSeconds / 60)}m`
      : 'window:open',
  ].join(':');
  if (executableTasks.length) {
    recommendation = await buildTaskRecommenderRecommendation({
      databaseConnection,
      currentPlayer,
      todos: executableTasks,
      source: 'next-move',
      decisionSeed: recommendationSeed,
      now,
      targetMinutes: Number.isFinite(availableWindowSeconds)
        ? Math.max(5, Math.floor(availableWindowSeconds / 60))
        : null,
    }).catch(() => null);
  }
  const selectedTask = recommendation?.task || executableTasks
    .sort((a, b) => taskPriorityClass(a, now) - taskPriorityClass(b, now))[0] || null;
  const selectedReceipt = selectedTask
    ? receiptByTask.get(String(selectedTask.UUID))
    : null;
  const executableWork = selectedTask ? {
    UUID: selectedTask.UUID,
    entityUUID: selectedTask.UUID,
    entityType: 'task',
    title: selectedReceipt && isTaskPlanReceiptValid(selectedReceipt, selectedTask)
      ? selectedReceipt.nextAction
      : selectedTask.nextAction || selectedTask.name || 'Begin the next task',
    context: recommendation
      ? `${recommendation.primaryReason}. ${recommendation.expectedWorkloadImpact}.`
      : 'This is the strongest executable action in the current window.',
    routeLabel: `Tasks → ${selectedTask.name || 'Untitled task'} → begin`,
    primaryAction: { type: 'begin-task', label: 'Begin' },
    priorityClass: taskPriorityClass(selectedTask, now),
    suggestedMinutes: recommendation?.suggestedMinutes || null,
    recommendation,
    sourceEntityRefs: [{ type: 'task', UUID: selectedTask.UUID }],
    invalidationKeys: [
      materialStateKey('task', selectedTask),
      `executable-set:${executableSetKey}`,
    ],
  } : null;

  const fixedCommitments = reminders
    .filter((item) => item.fixedCommitment && !item.completedAt && !item.dismissedAt)
    .map((item) => ({
      ...item,
      startAt: item.startAt || item.remindAt,
      durationMinutes: item.durationMinutes || item.estimatedDuration || 30,
    }));
  const dayOrientation = evaluateDayOrientationNeed({
    fixedCommitments,
    executableTasks,
    urgentTasks,
    availableWindowSeconds,
    impossibleSuggestionCount,
  });
  const goalDirection = evaluateGoalDirectionNeed({ goals, milestones });
  const boundary = latestMeaningfulSession(sessions);
  const boundaryAgeMs = boundary?.endedAt ? nowMs - safeTime(boundary.endedAt) : Infinity;
  const meaningfulReflection = boundary
    && boundaryAgeMs >= 0
    && boundaryAgeMs <= 12 * 60 * MINUTE
    && (
      boundary.outcome === 'blocked'
      || String(boundary.outcomeNote || '').trim()
      || String(boundary.nextStep || '').trim()
    )
    ? {
        UUID: boundary.UUID,
        title: 'Capture what changed',
        context: boundary.outcome === 'blocked'
          ? 'A blocker appeared and its context may be useful in Today’s Chronicle.'
          : 'Your last session preserved a decision or discovery.',
        routeLabel: 'Today’s Chronicle → append what changed',
        primaryAction: { type: 'append-chronicle', label: 'Capture what changed' },
        sourceEntityRefs: [{ type: 'action-session', UUID: boundary.UUID }],
        invalidationKeys: [materialStateKey('action-session', boundary)],
      }
    : null;
  const recovery = boundary
    && boundaryAgeMs >= 0
    && boundaryAgeMs <= 30 * MINUTE
    && Number(boundary.activeDurationMs || 0) >= 25 * MINUTE
    && urgentTasks.length === 0
    && !commitment
    ? {
        UUID: boundary.UUID,
        title: 'Take a break',
        context: 'You completed a sustained work period. Nothing fixed begins soon.',
        primaryAction: { type: 'step-away', label: 'Step away' },
        sourceEntityRefs: [{ type: 'action-session', UUID: boundary.UUID }],
        invalidationKeys: [materialStateKey('action-session', boundary)],
      }
    : null;

  return {
    playerUUID,
    decisionPoint,
    generatedAt: new Date(nowMs).toISOString(),
    activePairMatch,
    activeDojoSession,
    activeTaskSession,
    imminentCommitment: commitment ? {
      UUID: commitment.item.UUID,
      entityUUID: commitment.item.UUID,
      entityType: 'event',
      panel: 'events',
      title: commitment.item.title || 'Prepare for the next commitment',
      context: 'Its transition window has begun.',
      routeLabel: `Events → ${commitment.item.title || 'fixed commitment'} → prepare`,
      reasonCodes: [
        NEXT_MOVE_REASON.fixedCommitment,
        NEXT_MOVE_REASON.preparationRequired,
      ],
      sourceEntityRefs: [{ type: 'reminder', UUID: commitment.item.UUID }],
      invalidationKeys: [materialStateKey('reminder', commitment.item)],
    } : null,
    continuation,
    executableWork,
    clarification,
    dayOrientation,
    goalDirection,
    reflection: meaningfulReflection,
    recovery,
    alternatives: [
      ...executableTasks
        .filter((task) => task.UUID !== selectedTask?.UUID)
        .slice(0, 2)
        .map((task) => ({
          title: task.name,
          entityUUID: task.UUID,
          destination: {
            panel: 'tasks',
            entityType: 'task',
            entityUUID: task.UUID,
            subview: 'preview',
            focusTarget: 'begin-action',
            routeLabel: `Tasks → ${task.name} → begin`,
            worldLocationId: 'tasks',
          },
        })),
    ],
  };
}

export default buildNextMoveState;
