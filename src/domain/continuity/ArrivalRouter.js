import { STORES } from '@domain/constants.js';
import { buildSlopeContext, getDisplaySlope } from '@domain/tasks/Tasks.js';
import { getActiveHandoff } from './Handoff.js';
import { reconcileReentryState } from './ReentryPolicy.js';

export const ARRIVAL_PRIORITY = Object.freeze({
  resume: 700,
  handoff: 600,
  planned: 500,
  urgent: 400,
  goal: 300,
  recommended: 200,
  unstructured: 0,
});

function possible(candidate) {
  return candidate && !candidate.blocked && candidate.isPossibleNow !== false;
}

export function selectArrivalState(context = {}) {
  const candidates = [
    context.resumableSession,
    context.activeHandoff,
    ...(context.actionPlans || []),
    context.urgentDeadline,
    context.goalNextAction,
    context.recommenderCandidate,
  ].filter(possible);
  if (!candidates.length) return Object.freeze({ type: 'unstructured' });
  return Object.freeze([...candidates].sort((left, right) => (
    Number(right.priority || ARRIVAL_PRIORITY[right.type] || 0)
      - Number(left.priority || ARRIVAL_PRIORITY[left.type] || 0)
    || Number(right.utility || 0) - Number(left.utility || 0)
  ))[0]);
}

function dueState(todo, now) {
  if (!todo?.dueDate) return null;
  const due = new Date(todo.dueDate);
  if (!Number.isFinite(due.getTime())) return null;
  const remaining = due.getTime() - now.getTime();
  if (remaining < 0) return { label: 'Past due', utility: 1000 };
  if (remaining <= 24 * 60 * 60 * 1000) return { label: 'Due within 24 hours', utility: 700 };
  return null;
}

function taskCandidate(type, task, extra = {}) {
  if (!task) return null;
  return {
    type,
    priority: ARRIVAL_PRIORITY[type],
    targetType: 'todo',
    targetUUID: task.UUID,
    task,
    title: task.name || 'Untitled task',
    goalUUID: task.projectId || null,
    isPossibleNow: true,
    alternativesAvailable: true,
    ...extra,
  };
}

export async function buildArrivalState(databaseConnection, player, {
  now = new Date(),
  userSuppressedTargets = new Set(),
} = {}) {
  if (!databaseConnection || !player?.UUID) return { type: 'unstructured' };
  const [sessions, handoff, plans, todos, tasks, links, goals, reentry] = await Promise.all([
    databaseConnection.getPlayerStore(STORES.actionSession, player.UUID),
    getActiveHandoff(databaseConnection, player.UUID, now.getTime()),
    databaseConnection.getPlayerStore(STORES.actionPlan, player.UUID),
    databaseConnection.getAll(STORES.todo),
    databaseConnection.getPlayerStore(STORES.task, player.UUID),
    databaseConnection.getAll(STORES.goalLink),
    databaseConnection.getAll(STORES.project),
    reconcileReentryState(databaseConnection, player.UUID, now),
  ]);
  const openTodos = todos.filter((todo) => (
    (!todo.parent || String(todo.parent) === String(player.UUID))
    && !todo.completedAt
    && !userSuppressedTargets.has(todo.UUID)
  ));
  const todoById = new Map(openTodos.map((todo) => [String(todo.UUID), todo]));
  const activeSession = sessions.find((session) => session.outcome === 'active') || null;
  const resumeTask = activeSession ? todoById.get(String(activeSession.targetUUID)) : null;
  const resumableSession = activeSession ? taskCandidate('resume', resumeTask || {
    UUID: activeSession.targetUUID,
    name: activeSession.targetName || 'Unfinished action',
    projectId: activeSession.goalUUID,
  }, {
    session: activeSession,
    reasonCodes: ['unfinished-session'],
    explanation: 'Your last work state is still intact.',
  }) : null;
  const handoffTask = handoff?.resumeTargetUUID
    ? todoById.get(String(handoff.resumeTargetUUID))
    : null;
  const activeHandoff = handoff ? taskCandidate('handoff', handoffTask || {
    UUID: handoff.resumeTargetUUID,
    name: handoff.nextStep || handoff.generatedSummary || 'Continue where you left off',
    projectId: handoff.goalUUID,
  }, {
    handoff,
    reasonCodes: ['saved-next-step'],
    explanation: handoff.nextStep || 'You saved this as your next visible step.',
  }) : null;
  const nowMs = now.getTime();
  const duePlans = plans
    .filter((plan) => plan.status === 'active')
    .filter((plan) => !plan.plannedWindowStart || new Date(plan.plannedWindowStart).getTime() <= nowMs)
    .filter((plan) => !plan.plannedWindowEnd || new Date(plan.plannedWindowEnd).getTime() >= nowMs)
    .map((plan) => taskCandidate('planned', todoById.get(String(plan.targetUUID)), {
      plan,
      reasonCodes: ['planned-window-open'],
      explanation: 'This is the window you chose for this action.',
    }))
    .filter(Boolean);
  const urgent = openTodos
    .map((todo) => ({ todo, due: dueState(todo, now) }))
    .filter((row) => row.due)
    .sort((left, right) => right.due.utility - left.due.utility)[0];
  const urgentDeadline = urgent ? taskCandidate('urgent', urgent.todo, {
    utility: urgent.due.utility,
    reasonCodes: ['external-deadline'],
    explanation: urgent.due.label,
  }) : null;
  const activeGoalIds = new Set(goals
    .filter((goal) => !goal.archivedAt && !goal.completedAt && !['archived', 'completed'].includes(goal.lifecycleStatus || goal.status))
    .map((goal) => String(goal.UUID)));
  const nextActionLink = links.find((link) => (
    link.relation === 'next_action'
    && link.entityType === 'todo'
    && activeGoalIds.has(String(link.goalUUID))
    && todoById.has(String(link.entityUUID))
  ));
  const goalNextAction = nextActionLink
    ? taskCandidate('goal', todoById.get(String(nextActionLink.entityUUID)), {
        goalUUID: nextActionLink.goalUUID,
        reasonCodes: ['active-goal-next-action'],
        explanation: 'This is the next visible action for an active Goal.',
      })
    : null;
  const slopeContext = buildSlopeContext(tasks);
  const ranked = openTodos
    .map((todo) => ({ todo, score: getDisplaySlope(todo, slopeContext) }))
    .sort((left, right) => right.score - left.score);
  const recommenderCandidate = ranked[0]
    ? taskCandidate('recommended', ranked[0].todo, {
        utility: ranked[0].score,
        recommendationSource: 'continuity-rule-v1',
        reasonCodes: [
          ranked[0].todo.dueDate ? 'deadline-pressure' : 'current-queue-priority',
          ranked[0].todo.projectId ? 'supports-active-goal' : 'standalone-action',
        ],
        explanation: ranked[0].todo.dueDate
          ? 'Its deadline and current queue position make it the strongest next step.'
          : 'It is the strongest available action in your current queue.',
        confidence: null,
        observationEventUUID: null,
      })
    : null;
  const selected = selectArrivalState({
    resumableSession,
    activeHandoff,
    actionPlans: duePlans,
    urgentDeadline,
    goalNextAction,
    recommenderCandidate,
  });
  if (!reentry.extendedAbsence || selected.type === 'resume') return selected;
  return Object.freeze({
    ...selected,
    type: 'reentry',
    originalType: selected.type,
    priority: ARRIVAL_PRIORITY[selected.type],
    reentry,
    explanation: selected.explanation || 'A clear restart is ready.',
  });
}
