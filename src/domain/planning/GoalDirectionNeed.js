import { NEXT_MOVE_REASON } from '../navigation/NextMoveReasonCodes.js';

export function evaluateGoalDirectionNeed({
  goals = [],
  milestones = [],
  explicitGoalUUID = null,
  weeklyReviewDue = false,
  conflictingFocus = false,
} = {}) {
  const activeGoals = goals.filter((goal) => !goal.completedAt && !goal.archivedAt && goal.status !== 'archived');
  const target = explicitGoalUUID
    ? activeGoals.find((goal) => String(goal.UUID) === String(explicitGoalUUID))
    : activeGoals.find((goal) => {
        const activeMilestones = milestones.filter((milestone) => (
          String(milestone.goalUUID || milestone.projectId) === String(goal.UUID)
          && !milestone.completedAt
          && !milestone.blockedAt
        ));
        return activeMilestones.length === 0;
      });
  if (!target && !conflictingFocus && !weeklyReviewDue) return null;
  return {
    UUID: target?.UUID || 'goal-direction',
    entityUUID: target?.UUID || null,
    title: target
      ? `Choose the next milestone for ${target.name || 'this Goal'}`
      : 'Choose the current Goal focus',
    context: target
      ? 'This active Goal has no usable current milestone.'
      : conflictingFocus
        ? 'Multiple active Goals demand incompatible focus.'
        : 'A scheduled review is due and no higher-priority action exists.',
    routeLabel: target
      ? `Goals → ${target.name || 'Goal'} → choose next milestone`
      : 'Goals → choose current focus',
    reasonCodes: [
      target ? NEXT_MOVE_REASON.goalMissingMilestone : NEXT_MOVE_REASON.goalDirectionConflict,
    ],
    sourceEntityRefs: target ? [{ type: 'goal', UUID: target.UUID }] : [],
    invalidationKeys: [
      target
        ? `goal:${target.UUID}:${target.updatedAt || target.status || 'active'}`
        : `goal-focus:${activeGoals.map((goal) => goal.UUID).join(',')}`,
    ],
  };
}
