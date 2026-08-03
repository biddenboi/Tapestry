const DAY_MS = 24 * 60 * 60 * 1000;

export const GOAL_ATTENTION_PRIORITY = Object.freeze({
  blocked: 0,
  target_date_passed: 1,
  current_milestone_overdue: 2,
  no_finish_condition: 3,
  no_next_action: 4,
  target_within_7_days: 5,
  review_due: 6,
  no_linked_activity_14_days: 7,
  no_current_milestone: 8,
});

const time = (value) => {
  if (value == null || value === '') return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
};

const dateLabel = (value) => {
  const parsed = time(value);
  return parsed == null
    ? 'the target date'
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parsed);
};

const notice = (type, goal, message, actionLabel) => ({
  type,
  goalUUID: goal.UUID,
  goalName: goal.name || 'Untitled goal',
  message,
  actionLabel,
  priority: GOAL_ATTENTION_PRIORITY[type] ?? 99,
});

export function buildGoalAttention(goal = {}, {
  milestones = [],
  lastLinkedActivityAt = null,
  now = new Date(),
} = {}) {
  if (goal.lifecycleStatus !== 'active') return [];
  const nowMs = now instanceof Date ? now.getTime() : time(now) ?? Date.now();
  const result = [];
  const currentMilestone = milestones.find((entry) => (
    entry.UUID === goal.currentMilestoneUUID || entry.status === 'active'
  ));
  if (goal.healthStatus === 'blocked') {
    result.push(notice(
      'blocked',
      goal,
      `Blocked${goal.blockedReason ? `: ${goal.blockedReason}` : '.'}`,
      'Review blocker',
    ));
  }
  const targetMs = time(goal.targetDate);
  if (targetMs != null && targetMs < nowMs) {
    result.push(notice(
      'target_date_passed',
      goal,
      `Target date passed on ${dateLabel(goal.targetDate)}.`,
      'Review target',
    ));
  } else if (targetMs != null && targetMs - nowMs <= 7 * DAY_MS) {
    result.push(notice(
      'target_within_7_days',
      goal,
      `Target date is ${dateLabel(goal.targetDate)}.`,
      'Review plan',
    ));
  }
  const milestoneTargetMs = time(currentMilestone?.targetDate);
  if (milestoneTargetMs != null && milestoneTargetMs < nowMs
      && currentMilestone?.status !== 'completed') {
    result.push(notice(
      'current_milestone_overdue',
      goal,
      `Current milestone target passed on ${dateLabel(currentMilestone.targetDate)}.`,
      'Review milestone',
    ));
  }
  if (!String(goal.finishCondition || '').trim()) {
    result.push(notice('no_finish_condition', goal, 'The finish condition needs definition.', 'Define finish'));
  }
  if (!goal.nextAction) {
    result.push(notice('no_next_action', goal, 'No next action is selected.', 'Choose action'));
  }
  if (goal.progressType !== 'metric' && milestones.length > 0 && !currentMilestone) {
    result.push(notice('no_current_milestone', goal, 'No current milestone is selected.', 'Choose milestone'));
  }
  const reviewInterval = Math.max(1, Number(goal.reviewIntervalDays) || 7) * DAY_MS;
  const reviewedMs = time(goal.lastReviewedAt) ?? time(goal.createdAt);
  if (reviewedMs != null && nowMs - reviewedMs >= reviewInterval) {
    result.push(notice('review_due', goal, 'A goal review is due.', 'Check in'));
  }
  const activityMs = time(lastLinkedActivityAt);
  const createdMs = time(goal.createdAt) ?? nowMs;
  if ((activityMs == null && nowMs - createdMs >= 14 * DAY_MS)
      || (activityMs != null && nowMs - activityMs >= 14 * DAY_MS)) {
    result.push(notice(
      'no_linked_activity_14_days',
      goal,
      'No linked activity has been recorded in 14 days.',
      'Review goal',
    ));
  }
  return result.sort((left, right) => left.priority - right.priority);
}

export function buildAttentionList(goals = [], optionsByGoal = {}) {
  return goals.flatMap((goal) => buildGoalAttention(
    goal,
    optionsByGoal[goal.UUID] || {},
  )).sort((left, right) => left.priority - right.priority);
}
