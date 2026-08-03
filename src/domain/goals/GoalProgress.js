const ratioBetween = (start, current, target) => {
  const span = target - start;
  if (span === 0) return current === target ? 1 : 0;
  return Math.max(0, Math.min(1, (current - start) / span));
};

const orderedEligible = (milestones = []) => [...milestones]
  .filter((milestone) => milestone?.status !== 'skipped')
  .sort((left, right) => (
    Number(left.position || 0) - Number(right.position || 0)
    || String(left.UUID || '').localeCompare(String(right.UUID || ''))
  ));

const currentFrom = (milestones) => (
  milestones.find((milestone) => milestone.status === 'active')
  || milestones.find((milestone) => !['completed', 'skipped'].includes(milestone.status))
  || null
);

export function buildMilestoneProgress(milestones = []) {
  const eligible = orderedEligible(milestones);
  return {
    type: 'milestones',
    completed: eligible.filter((milestone) => milestone.status === 'completed').length,
    total: eligible.length,
    currentMilestone: currentFrom(eligible),
  };
}

export function buildMetricProgress(metric = null) {
  const startValue = Number(metric?.startValue) || 0;
  const currentValue = Number(metric?.currentValue) || 0;
  const targetValue = Number(metric?.targetValue) || 0;
  return {
    type: 'metric',
    startValue,
    currentValue,
    targetValue,
    unit: String(metric?.unit || ''),
    ratio: ratioBetween(startValue, currentValue, targetValue),
  };
}

export function buildLearningProgress(milestones = []) {
  const eligible = orderedEligible(milestones)
    .filter((milestone) => !milestone.kind || milestone.kind === 'learning_stage');
  return {
    type: 'learning',
    completedStages: eligible.filter((milestone) => milestone.status === 'completed').length,
    totalStages: eligible.length,
    currentStage: currentFrom(eligible),
  };
}

export function buildGoalProgress(goal = {}, milestones = []) {
  if (goal.progressType === 'metric') return buildMetricProgress(goal.metric);
  if (goal.progressType === 'learning') return buildLearningProgress(milestones);
  return buildMilestoneProgress(milestones);
}

export function progressRatio(progress) {
  if (!progress) return 0;
  if (progress.type === 'metric') return progress.ratio;
  const completed = progress.type === 'learning' ? progress.completedStages : progress.completed;
  const total = progress.type === 'learning' ? progress.totalStages : progress.total;
  return total > 0 ? completed / total : 0;
}
