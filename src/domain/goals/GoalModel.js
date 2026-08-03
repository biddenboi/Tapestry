export const GOAL_PROGRESS_TYPES = Object.freeze(['milestones', 'metric', 'learning']);
export const GOAL_LIFECYCLE_STATUSES = Object.freeze(['active', 'paused', 'completed', 'archived']);
export const GOAL_HEALTH_STATUSES = Object.freeze(['unset', 'on_track', 'at_risk', 'blocked']);
export const GOAL_PARTICIPATION_MODES = Object.freeze(['private', 'collaborative', 'competitive']);
export const GOAL_VISIBILITIES = Object.freeze(['private', 'participants', 'friends']);
export const GOAL_MILESTONE_STATUSES = Object.freeze([
  'not_started',
  'active',
  'blocked',
  'completed',
  'skipped',
]);

const enumValue = (value, values, fallback) => (
  values.includes(value) ? value : fallback
);

const cleanText = (value, maximum = Infinity) => {
  const text = String(value ?? '').trim();
  return Number.isFinite(maximum) ? text.slice(0, maximum) : text;
};

export function getGoalLifecycleStatus(goal = {}) {
  if (GOAL_LIFECYCLE_STATUSES.includes(goal.lifecycleStatus)) return goal.lifecycleStatus;
  if (goal.archivedAt || goal.status === 'archived') return 'archived';
  if (goal.completedAt || goal.status === 'completed') return 'completed';
  if (goal.status === 'paused') return 'paused';
  return 'active';
}

export function normalizeGoalMetric(metric = null, now = new Date().toISOString()) {
  if (!metric || typeof metric !== 'object') return null;
  const startValue = Number(metric.startValue);
  const currentValue = Number(metric.currentValue);
  const targetValue = Number(metric.targetValue);
  return {
    unit: cleanText(metric.unit, 30),
    startValue: Number.isFinite(startValue) ? startValue : 0,
    currentValue: Number.isFinite(currentValue) ? currentValue : 0,
    targetValue: Number.isFinite(targetValue) ? targetValue : 0,
    direction: metric.direction === 'decrease' ? 'decrease' : 'increase',
    updatedAt: metric.updatedAt || now,
    source: ['manual', 'linked_event', 'linked_import'].includes(metric.source)
      ? metric.source
      : 'manual',
  };
}

export function normalizeGoalActionReference(action = null) {
  if (!action || typeof action !== 'object' || !action.entityUUID) return null;
  const entityType = ['todo', 'task', 'habit', 'reminder', 'event'].includes(action.entityType)
    ? action.entityType
    : 'todo';
  return {
    entityType,
    entityUUID: String(action.entityUUID),
    labelSnapshot: cleanText(action.labelSnapshot || 'Selected action', 160),
    pinnedAt: action.pinnedAt || new Date().toISOString(),
  };
}

export function normalizeGoal(goal = {}, {
  now = new Date().toISOString(),
  playerUUID = goal.parent || null,
} = {}) {
  const hadFinishCondition = cleanText(goal.finishCondition).length > 0;
  const lifecycleStatus = getGoalLifecycleStatus(goal);
  const participationMode = enumValue(
    goal.participationMode,
    GOAL_PARTICIPATION_MODES,
    'collaborative',
  );
  return {
    ...goal,
    parent: goal.parent || playerUUID,
    name: cleanText(goal.name || 'Untitled goal', 80),
    description: cleanText(goal.description, 500) || null,
    finishCondition: cleanText(goal.finishCondition ?? goal.description, 500),
    progressType: enumValue(goal.progressType, GOAL_PROGRESS_TYPES, 'milestones'),
    targetDate: goal.targetDate || null,
    lifecycleStatus,
    status: lifecycleStatus,
    healthStatus: enumValue(goal.healthStatus, GOAL_HEALTH_STATUSES, 'unset'),
    blockedReason: cleanText(goal.blockedReason, 300) || null,
    currentMilestoneUUID: goal.currentMilestoneUUID || null,
    nextAction: normalizeGoalActionReference(goal.nextAction),
    implementationCue: cleanText(goal.implementationCue, 300) || null,
    obstacle: cleanText(goal.obstacle, 300) || null,
    obstacleResponse: cleanText(goal.obstacleResponse, 300) || null,
    participationMode,
    visibility: enumValue(
      goal.visibility,
      GOAL_VISIBILITIES,
      participationMode === 'private' ? 'private' : 'participants',
    ),
    lastReviewedAt: goal.lastReviewedAt || null,
    reviewIntervalDays: Math.max(1, Math.round(Number(goal.reviewIntervalDays) || 7)),
    taskCategoryEnabled: goal.taskCategoryEnabled !== false,
    hideFromTasks: goal.taskCategoryEnabled === false || goal.hideFromTasks === true,
    metric: normalizeGoalMetric(goal.metric, now),
    needsGoalDefinition: goal.needsGoalDefinition ?? !hadFinishCondition,
    createdAt: goal.createdAt || now,
    updatedAt: goal.updatedAt || now,
    inGameTimestamp: Math.max(0, Number(goal.inGameTimestamp) || 0),
  };
}

export function normalizeGoalArea(area = {}, {
  now = new Date().toISOString(),
  playerUUID = area.parent || null,
} = {}) {
  return {
    ...area,
    parent: area.parent || playerUUID,
    name: cleanText(area.name || 'Untitled area', 60),
    description: cleanText(area.description, 300) || null,
    icon: cleanText(area.icon, 4) || null,
    accentColor: cleanText(area.accentColor, 32) || null,
    sortOrder: Math.max(0, Math.trunc(Number(area.sortOrder) || 0)),
    archivedAt: area.archivedAt || null,
    createdAt: area.createdAt || now,
    updatedAt: area.updatedAt || now,
    inGameTimestamp: Math.max(0, Number(area.inGameTimestamp) || 0),
  };
}

export function normalizeGoalMilestone(milestone = {}, {
  now = new Date().toISOString(),
  playerUUID = milestone.parent || null,
  progressType = 'milestones',
} = {}) {
  return {
    ...milestone,
    parent: milestone.parent || playerUUID,
    goalUUID: milestone.goalUUID || null,
    title: cleanText(milestone.title || 'Untitled milestone', 120),
    description: cleanText(milestone.description, 400) || null,
    kind: progressType === 'learning' || milestone.kind === 'learning_stage'
      ? 'learning_stage'
      : 'milestone',
    position: Math.max(0, Math.trunc(Number(milestone.position) || 0)),
    status: enumValue(milestone.status, GOAL_MILESTONE_STATUSES, 'not_started'),
    targetDate: milestone.targetDate || null,
    completedAt: milestone.completedAt || null,
    createdAt: milestone.createdAt || now,
    updatedAt: milestone.updatedAt || now,
    inGameTimestamp: Math.max(0, Number(milestone.inGameTimestamp) || 0),
    completedInGameTimestamp: milestone.completedInGameTimestamp == null
      ? null
      : Math.max(0, Number(milestone.completedInGameTimestamp) || 0),
  };
}

export function isGoalDefinitionVague(goal = {}) {
  const title = cleanText(goal.name).toLowerCase();
  const finish = cleanText(goal.finishCondition).toLowerCase();
  if (finish.replace(/\s/g, '').length < 12) return true;
  if (finish === title) return true;
  return /\b(get better|improve|work on)\b/.test(finish)
    && !/\d|reach|complete|finish|publish|ship|launch|demonstrate|able to/.test(finish);
}

export function isVisibleAtIGT(record, viewerIGT = Infinity) {
  if (!record) return false;
  const limit = Number(viewerIGT);
  if (!Number.isFinite(limit)) return true;
  return Number(record.inGameTimestamp || 0) <= limit;
}

export function milestoneVisibleAtIGT(milestone, viewerIGT = Infinity) {
  if (!isVisibleAtIGT(milestone, viewerIGT)) return false;
  const completionIGT = Number(milestone?.completedInGameTimestamp);
  if (!Number.isFinite(Number(viewerIGT)) || !Number.isFinite(completionIGT)) return true;
  return completionIGT <= Number(viewerIGT) || milestone.status !== 'completed';
}
