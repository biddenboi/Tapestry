import { mapR1NextMove } from '@domain/navigation/R1NextMove.js';
import { STORES } from '../constants.js';
import { materialStateKey } from './NextMoveInvalidation.js';
import {
  buildTaskClarificationCandidate,
  normalizeTaskPlanningMetadata,
} from '../planning/TaskPlanningEligibility.js';
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
    .filter(item => !item.completedAt && !item.dismissedAt && item.fixedCommitment !== false)
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
    reminders,
    sessions,
  ] = await Promise.all([
    readPlayerStore(databaseConnection, STORES.todo, playerUUID),
    readPlayerStore(databaseConnection, STORES.taskPlanReceipt, playerUUID),
    readPlayerStore(databaseConnection, STORES.reminder, playerUUID),
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

  const clarification = todos
    .map((task) => buildTaskClarificationCandidate(
      task,
      receiptByTask.get(String(task.UUID)),
      now,
    ))
    .filter(Boolean)
    .sort((a, b) => a.priorityClass - b.priorityClass)[0] || null;

  const boundaryState = await databaseConnection.get(STORES.appSetting, `r1.workWindow:${playerUUID}`);
  const workEnd = safeTime(boundaryState?.value?.endsAt);
  const windowEndMs = [nextStart, workEnd].filter(t => t != null && t > nowMs).sort((a,b)=>a-b)[0] || null;
  const r1Result = await databaseConnection.decideR1({ now: new Date(nowMs), todos,
    windowEnd: windowEndMs == null ? null : new Date(windowEndMs),
    workWindow: boundaryState?.value || null });
  const { executableWork, alternatives, r1 } = mapR1NextMove({ ...r1Result, todos,
    windowMinutes: windowEndMs == null ? Infinity : Math.max(0, (windowEndMs-nowMs)/MINUTE) });
  const dayOrientation = null;
  const goalDirection = null;
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
  const recovery = null;

  return {
    playerUUID,
    decisionPoint,
    generatedAt: new Date(nowMs).toISOString(),
    activePairMatch,
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
    continuation: null,
    executableWork,
    clarification,
    dayOrientation,
    goalDirection,
    reflection: meaningfulReflection,
    recovery,
    alternatives,
    r1,
  };
}

export default buildNextMoveState;
