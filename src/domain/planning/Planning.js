import { DAY, HOUR, MINUTE } from '@domain/constants.js';
import {
  buildSlopeContext,
  coerceAversion,
  getDisplaySlope,
} from '@domain/tasks/Tasks.js';
import { getLocalDate } from '@domain/time/Time.js';

export const PLANNING_MODES = [
  { id: 'normal', label: 'Normal push', minutes: 25 },
  { id: 'quick', label: 'I have 10m', minutes: 10 },
  { id: 'important', label: 'Most important', minutes: 30 },
  { id: 'debt', label: 'Clear overdue debt', minutes: 20 },
  { id: 'momentum', label: 'Continue momentum', minutes: 30 },
  { id: 'deep', label: 'Deep work', minutes: 50 },
];

const startOfDay = (value = new Date()) => getLocalDate(new Date(value));

const dateDiffDays = (left, right) => Math.round(
  (startOfDay(left).getTime() - startOfDay(right).getTime()) / DAY,
);

const taskMinutes = (task) => Math.max(1, Number(task?.estimatedDuration) || 1);

const historyMinutes = (task) => {
  const committed = Number(task?.sessionDuration || 0) / MINUTE;
  if (committed > 0) return committed;
  const elapsed = task?.createdAt && task?.completedAt
    ? (new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / MINUTE
    : 0;
  if (elapsed > 0 && elapsed < 24 * 60) return elapsed;
  return Math.max(0, Number(task?.originalDuration || task?.estimatedDuration || 0));
};

export function formatPlanningMinutes(minutes = 0) {
  const rounded = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function buildRecentHistory(history, currentDate) {
  const today = startOfDay(currentDate);
  const recentStart = new Date(today);
  recentStart.setDate(recentStart.getDate() - 13);
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(recentStart);
    date.setDate(date.getDate() + index);
    return {
      key: date.toLocaleDateString('en-CA'),
      minutes: 0,
    };
  });
  const byKey = Object.fromEntries(daily.map((entry) => [entry.key, entry]));

  for (const task of history || []) {
    if (!task?.completedAt) continue;
    const key = startOfDay(task.completedAt).toLocaleDateString('en-CA');
    if (byKey[key]) byKey[key].minutes += historyMinutes(task);
  }

  const total = daily.reduce((sum, entry) => sum + entry.minutes, 0);
  return {
    daily,
    averageMinutes: total / daily.length,
    activeDayAverageMinutes: total / Math.max(1, daily.filter((entry) => entry.minutes > 0).length),
  };
}

function getBacklogPressure(tasks, currentDate) {
  const weightedMinutes = tasks.reduce((sum, task) => {
    const ageDays = task.createdAt
      ? Math.max(0, dateDiffDays(currentDate, task.createdAt))
      : 0;
    const aversion = coerceAversion(task.aversion);
    const skips = Number(task.recommendationSkips || task.skipCount || 0);
    return sum + taskMinutes(task)
      * (1 + Math.min(0.7, ageDays / 60))
      * (1 + (aversion - 1) * 0.2)
      * (1 + Math.min(0.5, skips * 0.08));
  }, 0);

  const label = weightedMinutes >= 600
    ? 'Critical'
    : weightedMinutes >= 300
      ? 'High'
      : weightedMinutes >= 120
        ? 'Medium'
        : weightedMinutes > 0 ? 'Low' : 'Clear';

  return { label, score: weightedMinutes };
}

function buildForecast(scheduledTasks, currentDate, recentAverageMinutes) {
  const today = startOfDay(currentDate);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() + index);
    return {
      key: date.toLocaleDateString('en-CA'),
      date,
      label: index === 0
        ? 'Today'
        : index === 1
          ? 'Tomorrow'
          : date.toLocaleDateString('en-US', { weekday: 'short' }),
      minutes: 0,
      tasks: [],
    };
  });

  for (const task of scheduledTasks) {
    const daysUntilDue = dateDiffDays(task.dueDate, today);
    if (daysUntilDue < 0) continue;
    const inclusiveDays = daysUntilDue + 1;
    const dailyShare = taskMinutes(task) / inclusiveDays;
    for (let index = 0; index <= Math.min(daysUntilDue, 6); index += 1) {
      days[index].minutes += dailyShare;
      days[index].tasks.push(task);
    }
  }

  const normalCapacity = Math.max(60, recentAverageMinutes || 0);
  const riskiest = [...days].sort((a, b) => b.minutes - a.minutes)[0];
  const risk = riskiest?.minutes > normalCapacity * 1.5
    ? `${riskiest.label} overloaded`
    : riskiest?.minutes > normalCapacity * 1.1
      ? `${riskiest.label} is tight`
      : 'No overload detected';

  return {
    days,
    next7DaysMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
    risk,
    riskDay: riskiest || null,
    normalCapacity,
  };
}

export function buildWorkloadModel(todos = [], history = [], currentDate = new Date(), options = {}) {
  const today = startOfDay(currentDate);
  const scheduled = [];
  const overdue = [];
  const backlog = [];

  for (const task of todos || []) {
    if (!task?.dueDate) {
      backlog.push(task);
      continue;
    }
    if (dateDiffDays(task.dueDate, today) < 0) overdue.push(task);
    else scheduled.push(task);
  }

  const scheduledPaceMinutes = scheduled.reduce((sum, task) => {
    const inclusiveDays = dateDiffDays(task.dueDate, today) + 1;
    return sum + (taskMinutes(task) / Math.max(1, inclusiveDays));
  }, 0);
  const overdueDebtMinutes = overdue.reduce((sum, task) => sum + taskMinutes(task), 0);
  const recent = buildRecentHistory(history, currentDate);
  const todayProgressMinutes = Math.max(
    0,
    Number(options.todayProgressMinutes ?? recent.daily.at(-1)?.minutes ?? 0) || 0,
  );
  const todayRemainingMinutes = Math.max(0, scheduledPaceMinutes - todayProgressMinutes);
  const backlogPressure = getBacklogPressure(backlog, currentDate);
  const forecast = buildForecast(scheduled, currentDate, recent.averageMinutes);

  const hour = new Date(currentDate).getHours() + (new Date(currentDate).getMinutes() / 60);
  const dayProgress = Math.max(0, Math.min(1, (hour - 8) / 12));
  const expectedByNow = scheduledPaceMinutes * dayProgress;
  const paceDeltaMinutes = todayProgressMinutes - expectedByNow;
  const paceStatus = paceDeltaMinutes >= 10
    ? 'ahead'
    : paceDeltaMinutes <= -10
      ? 'behind'
      : 'on-pace';
  const comparisonRatio = recent.averageMinutes > 0
    ? scheduledPaceMinutes / recent.averageMinutes
    : scheduledPaceMinutes > 0 ? 1 : 0;
  const paceLabel = comparisonRatio >= 2
    ? 'far above normal'
    : comparisonRatio >= 1.2
      ? 'slightly above normal'
      : comparisonRatio <= 0.7 && recent.averageMinutes > 0
        ? 'below normal'
        : 'near normal';

  return {
    generatedAt: new Date(currentDate).toISOString(),
    scheduledPaceMinutes,
    overdueDebtMinutes,
    backlogPressure,
    todayProgressMinutes,
    todayRemainingMinutes,
    expectedByNow,
    paceDeltaMinutes,
    paceStatus,
    paceLabel,
    recentAverageMinutes: recent.averageMinutes,
    recentActiveDayAverageMinutes: recent.activeDayAverageMinutes,
    comparisonRatio,
    forecast,
    tasks: { scheduled, overdue, backlog },
  };
}

function addReason(reasons, id, label, detail, points) {
  if (points <= 0) return;
  reasons.push({ id, label, detail, points });
}

function scoreTask(task, workloadModel, history, options, slopeContext) {
  const mode = options.mode || 'normal';
  const now = new Date(options.currentDate || workloadModel.generatedAt || Date.now());
  const duration = taskMinutes(task);
  const dueDiff = task.dueDate ? dateDiffDays(task.dueDate, now) : null;
  const ageDays = task.createdAt ? Math.max(0, dateDiffDays(now, task.createdAt)) : 0;
  const aversion = coerceAversion(task.aversion);
  const skips = Number(task.recommendationSkips || task.skipCount || 0);
  const lastSkippedAt = task.lastRecommendationSkippedAt
    ? new Date(task.lastRecommendationSkippedAt).getTime()
    : 0;
  const skipAge = lastSkippedAt ? now.getTime() - lastSkippedAt : Infinity;
  const recentProject = [...(history || [])]
    .filter((entry) => entry?.completedAt && entry.projectId)
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0]?.projectId;
  const momentum = Boolean(task.projectId && recentProject && task.projectId === recentProject);
  const slope = getDisplaySlope(task, slopeContext);
  const reasons = [];
  let score = 12 + Math.min(28, slope * 3);

  if (dueDiff != null && dueDiff < 0) {
    const points = 46 + Math.min(18, Math.abs(dueDiff) * 3);
    score += points;
    addReason(reasons, 'overdue', 'overdue', `${Math.abs(dueDiff)}d overdue`, points);
    addReason(reasons, 'debt', 'clears workload debt', formatPlanningMinutes(duration), 15);
  } else if (dueDiff === 0) {
    score += 38;
    addReason(reasons, 'today', 'due today', 'scheduled for today', 38);
  } else if (dueDiff === 1) {
    score += 30;
    addReason(reasons, 'tomorrow', 'due tomorrow', 'one day left', 30);
  } else if (dueDiff != null && dueDiff <= 4) {
    const points = 24 - dueDiff * 2;
    score += points;
    addReason(reasons, 'soon', 'due soon', `${dueDiff}d left`, points);
  } else if (dueDiff == null) {
    const points = Math.min(20, ageDays * 0.6);
    score += points;
    addReason(reasons, 'backlog', 'backlog pressure', `${ageDays}d old`, points);
  }

  if (aversion >= 2) {
    const points = (aversion - 1) * 10;
    score += points;
    addReason(reasons, 'resistance', aversion === 3 ? 'high resistance' : 'moderate resistance', `level ${aversion}`, points);
  }
  if (ageDays >= 10) {
    const points = Math.min(16, ageDays / 2);
    score += points;
    addReason(reasons, 'neglected', 'long neglected', `${ageDays}d waiting`, points);
  }
  if (skipAge < 2 * HOUR) {
    score -= 70;
  } else if (skips > 0) {
    const points = Math.min(20, skips * 5);
    score += points;
    addReason(reasons, 'skipped', 'recently skipped', `${skips} time${skips === 1 ? '' : 's'}`, points);
  }
  if (momentum) {
    score += mode === 'momentum' ? 38 : 12;
    addReason(reasons, 'momentum', 'project momentum', task.projectName || 'recent project', mode === 'momentum' ? 38 : 12);
  }

  const targetMinutes = Math.max(5, Number(options.timeAvailable || PLANNING_MODES.find((entry) => entry.id === mode)?.minutes || 25));
  const fit = Math.abs(duration - targetMinutes);
  if (duration <= targetMinutes) {
    const points = Math.max(5, 20 - fit * 0.5);
    score += points;
    addReason(reasons, 'fit', duration <= 10 ? 'quick win' : 'fits your time', `${duration}m`, points);
  } else {
    score -= Math.min(22, (duration - targetMinutes) * 0.25);
  }

  if (mode === 'quick') {
    score += duration <= 10 ? 34 : duration <= 15 ? 18 : -Math.min(34, duration - 15);
  }
  if (mode === 'deep') {
    score += duration >= 45 ? 32 : duration >= 30 ? 14 : -10;
  }
  if (mode === 'debt') {
    score += dueDiff != null && dueDiff < 0 ? 40 : -8;
  }
  if (mode === 'important') {
    score += Math.min(32, slope * 4);
  }
  if (mode === 'normal' && duration >= 20 && duration <= 35) score += 14;

  const dailyImpact = task.dueDate && dueDiff != null && dueDiff >= 0
    ? duration / (dueDiff + 1)
    : duration;
  const expectedWorkloadImpact = dueDiff != null && dueDiff < 0
    ? `Clears ${formatPlanningMinutes(duration)} from overdue debt`
    : dueDiff == null
      ? `Reduces backlog pressure by ${formatPlanningMinutes(duration)}`
      : `Clears about ${formatPlanningMinutes(dailyImpact)} from today's pace`;
  const suggestedMinutes = Math.max(5, Math.min(duration, targetMinutes));

  const sortedReasons = reasons.sort((a, b) => b.points - a.points);
  return {
    task,
    score: Math.max(1, score),
    weight: Math.max(0.1, score) ** 1.35,
    reasons: sortedReasons,
    primaryReason: sortedReasons[0]?.label || 'balanced priority',
    supportingReasons: sortedReasons.slice(1, 3).map((reason) => reason.label),
    reasonChips: sortedReasons.slice(0, 3).map((reason) => reason.label),
    expectedWorkloadImpact,
    suggestedMinutes,
    breakdown: {
      dueInDays: dueDiff,
      ageDays,
      aversion,
      skips,
      slope,
      duration,
      mode,
      targetMinutes,
    },
  };
}

export function buildPlanningCandidates(
  todos = [],
  workloadModel,
  history = [],
  options = {},
) {
  if (!todos.length || !workloadModel) return [];
  const slopeContext = options.slopeContext || buildSlopeContext(history);
  return todos
    .map((task) => scoreTask(task, workloadModel, history, options, slopeContext))
    .sort((a, b) => b.score - a.score);
}
