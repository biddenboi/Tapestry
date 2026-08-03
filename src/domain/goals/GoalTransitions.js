export const GOAL_TRANSITIONS = Object.freeze({
  active: Object.freeze(['paused', 'completed', 'archived']),
  paused: Object.freeze(['active', 'completed', 'archived']),
  completed: Object.freeze(['active', 'archived']),
  archived: Object.freeze(['active']),
});

export function canTransitionGoal(from, to) {
  return Boolean(GOAL_TRANSITIONS[from]?.includes(to));
}

export function buildGoalTransition(goal, to, {
  now = new Date().toISOString(),
  inGameTimestamp = goal.inGameTimestamp || 0,
  finishConfirmed = false,
} = {}) {
  const from = goal.lifecycleStatus || goal.status || 'active';
  if (!canTransitionGoal(from, to)) {
    const error = new Error(`Goal cannot transition from ${from} to ${to}.`);
    error.code = 'invalid-goal-transition';
    throw error;
  }
  if (to === 'completed' && !finishConfirmed) {
    const error = new Error('Confirm the finish condition before completing this goal.');
    error.code = 'goal-finish-confirmation-required';
    throw error;
  }
  const next = {
    ...goal,
    lifecycleStatus: to,
    status: to,
    updatedAt: now,
    completedAt: to === 'completed' ? (goal.completedAt || now) : (to === 'active' ? null : goal.completedAt),
    archivedAt: to === 'archived' ? (goal.archivedAt || now) : (to === 'active' ? null : goal.archivedAt),
  };
  const update = {
    parent: goal.parent,
    goalUUID: goal.UUID,
    kind: 'status_change',
    summary: `Goal moved from ${from.replaceAll('_', ' ')} to ${to.replaceAll('_', ' ')}.`,
    healthStatusSnapshot: goal.healthStatus || 'unset',
    lifecycleStatusSnapshot: to,
    sourceType: 'goal_transition',
    sourceUUID: `${goal.UUID}:${to}:${now}`,
    createdAt: now,
    inGameTimestamp,
  };
  return { goal: next, update, shouldAwardCompletion: to === 'completed' };
}
