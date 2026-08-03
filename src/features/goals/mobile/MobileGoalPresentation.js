function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isOrdinaryMobileGoal(card) {
  const lifecycle = card?.lifecycleStatus || card?.goal?.lifecycleStatus || 'active';
  return lifecycle === 'active';
}

export function selectMobileGoalCards(overview = {}) {
  const ordinary = asArray(overview?.activeGoals).filter(isOrdinaryMobileGoal);
  const blocked = ordinary.filter((card) => card?.healthStatus === 'blocked');
  const active = ordinary.filter((card) => card?.healthStatus !== 'blocked');
  return Object.freeze({
    active: Object.freeze(active),
    blocked: Object.freeze(blocked),
    cards: Object.freeze([...blocked, ...active]),
  });
}

export function buildMobileGoalDetailFacts(detail = {}) {
  const goal = detail.goal || {};
  const nextMilestone = asArray(detail.milestones)
    .find((milestone) => milestone?.status !== 'completed') || null;
  const linkedTask = asArray(detail.linkedWork)
    .find((item) => ['todo', 'task'].includes(item?.entityType)) || null;
  const nextAction = goal.nextAction?.summary
    || goal.nextAction
    || linkedTask?.name
    || linkedTask?.title
    || null;
  const blocker = goal.blocker?.summary
    || goal.blocker
    || goal.blockedReason
    || null;
  return Object.freeze({
    nextAction,
    blocker,
    nextMilestone,
    finishCondition: goal.finishCondition || 'Keep moving toward the next meaningful state.',
  });
}

export function mobileGoalProgressLabel(progress = {}) {
  if (Number.isFinite(Number(progress.percent))) return `${Math.round(Number(progress.percent))}%`;
  if (Number.isFinite(Number(progress.completed)) && Number.isFinite(Number(progress.total))) {
    return `${progress.completed}/${progress.total}`;
  }
  return progress.label || 'In progress';
}

export function mobileGoalActivityLabel(value, locale = undefined) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
