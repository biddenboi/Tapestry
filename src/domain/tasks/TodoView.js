import { DAY } from '../constants.js';
import { coerceAversion, getDisplaySlope, getSlopeTier, getTodoWPD } from './Tasks.js';
import { getLocalDate } from '../time/Time.js';
import {
  buildWorkloadModel,
  formatPlanningMinutes,
} from '../planning/Planning.js';

export const TODO_HUB_TABS = [
  ['upcoming', 'Upcoming'],
  ['today', 'Todos'],
  ['reminders', 'Reminders'],
];

export const TODO_DUE_FILTERS = [
  ['all', 'All due'],
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['later', 'Later'],
  ['unscheduled', 'Unscheduled'],
];

export const TODO_SORTS = [
  ['smart', 'Smart'],
  ['due', 'Due date'],
  ['slope', 'Priority'],
  ['duration', 'Duration'],
  ['created', 'Created'],
];

export function startOfDay(date = new Date()) {
  const d = getLocalDate(new Date(date));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function dateKey(date) {
  if (!date) return 'unscheduled';
  const d = startOfDay(date);
  if (Number.isNaN(d.getTime())) return 'unscheduled';
  return d.toLocaleDateString('en-CA');
}

export function dateInputValue(date) {
  if (!date) return '';
  const d = startOfDay(date);
  if (Number.isNaN(d.getTime())) return '';
  return dateKey(d);
}

function dateOnlyToLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year)
    || date.getMonth() !== Number(month) - 1
    || date.getDate() !== Number(day)) return null;
  return date;
}

export function makeDueDateForDay(day, existingDueDate = null) {
  const d = typeof day === 'string' ? dateOnlyToLocalDate(day) : null;
  const target = startOfDay(d || day);
  const existing = existingDueDate ? new Date(existingDueDate) : null;
  if (existing && !Number.isNaN(existing.getTime())) {
    target.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
  } else {
    target.setHours(23, 59, 0, 0);
  }
  return target.toISOString();
}

export function normalizeTaskDraft(task = {}) {
  const estimatedDuration = Number(task?.estimatedDuration);
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const projectId = ['string', 'number'].includes(typeof task?.projectId)
    ? String(task.projectId)
    : null;
  return {
    ...task,
    name: String(task?.name ?? task?.title ?? ''),
    dueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
    estimatedDuration: Number.isFinite(estimatedDuration) && estimatedDuration >= 0
      ? estimatedDuration
      : 0,
    projectId,
    aversion: coerceAversion(task?.aversion),
    efficiency: String(task?.efficiency ?? task?.description ?? ''),
  };
}

export function getWeekDays(anchor = new Date()) {
  const start = startOfDay(anchor);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function getMonthGrid(anchor = new Date()) {
  const first = startOfDay(anchor);
  first.setDate(1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function dueStateFor(todo, today) {
  if (!todo.dueDate) return 'unscheduled';
  const due = startOfDay(todo.dueDate);
  const diffDays = Math.round((due.getTime() - today.getTime()) / DAY);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'week';
  return 'later';
}

function compareSmart(a, b) {
  const aDue = a.dueDateObj?.getTime() ?? Infinity;
  const bDue = b.dueDateObj?.getTime() ?? Infinity;
  if (a.dueState === 'overdue' && b.dueState !== 'overdue') return -1;
  if (b.dueState === 'overdue' && a.dueState !== 'overdue') return 1;
  if (aDue !== bDue) return aDue - bDue;
  return b.slope - a.slope;
}

function compareBySort(sort) {
  if (sort === 'due') return (a, b) => (a.dueDateObj?.getTime() ?? Infinity) - (b.dueDateObj?.getTime() ?? Infinity);
  if (sort === 'slope') return (a, b) => b.slope - a.slope;
  if (sort === 'duration') return (a, b) => Number(b.estimatedDuration || 0) - Number(a.estimatedDuration || 0);
  if (sort === 'created') return (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  return compareSmart;
}

export function annotateTodos(todos = [], projects = [], slopeContext = null) {
  const today = startOfDay(new Date());
  const projectMap = Object.fromEntries(projects.map((project) => [project.UUID, project]));
  return todos.map((todo) => {
    const dueDateObj = todo.dueDate ? new Date(todo.dueDate) : null;
    const dueState = dueStateFor(todo, today);
    const slope = getDisplaySlope(todo, slopeContext);
    return {
      ...todo,
      dueDateObj,
      dueKey: dueDateObj && !Number.isNaN(dueDateObj.getTime()) ? dateKey(dueDateObj) : 'unscheduled',
      dueState,
      isOverdue: dueState === 'overdue',
      isToday: dueState === 'today',
      slope,
      slopeTier: getSlopeTier(slope),
      projectName: projectMap[todo.projectId]?.name || '',
      projectColor: projectMap[todo.projectId]?.color
        || projectMap[todo.projectId]?.accentColor
        || projectMap[todo.projectId]?.themeColor
        || null,
      wpd: getTodoWPD(todo),
      ageDays: todo.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(todo.createdAt).getTime()) / DAY)) : 0,
    };
  });
}

export function filterAnnotatedTodos(tasks = [], filters = {}) {
  const {
    search = '',
    projectId = 'all',
    dueState = 'all',
    slopeTier = 'all',
    sort = 'smart',
  } = filters;
  const query = search.trim().toLowerCase();
  return tasks
    .filter((task) => {
      if (projectId !== 'all') {
        if (projectId === '__none__') {
          if (task.projectId) return false;
        } else if (task.projectId !== projectId) return false;
      }
      if (dueState !== 'all' && task.dueState !== dueState) return false;
      if (slopeTier !== 'all' && task.slopeTier !== slopeTier) return false;
      if (query) {
        const haystack = [task.name, task.projectName, task.efficiency, task.dueState]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort(compareBySort(sort));
}

export function buildProjectSummaries(annotatedTasks = [], projects = []) {
  const summaries = [
    ...projects.map((project) => ({
      id: project.UUID,
      name: project.name,
      project,
      tasks: [],
      count: 0,
      overdue: 0,
      dueToday: 0,
      minutes: 0,
    })),
    {
      id: '__none__',
      name: 'No Goal',
      project: null,
      tasks: [],
      count: 0,
      overdue: 0,
      dueToday: 0,
      minutes: 0,
    },
  ];
  const byId = Object.fromEntries(summaries.map((summary) => [summary.id, summary]));

  for (const task of annotatedTasks) {
    const summary = byId[task.projectId || '__none__'] || byId.__none__;
    summary.tasks.push(task);
    summary.count += 1;
    summary.overdue += task.dueState === 'overdue' ? 1 : 0;
    summary.dueToday += task.dueState === 'today' ? 1 : 0;
    summary.minutes += Number(task.estimatedDuration || 0);
  }

  return summaries
    .filter((summary) => summary.project || summary.count > 0)
    .map((summary) => ({
      ...summary,
      tasks: [...summary.tasks].sort(compareSmart),
    }));
}

export function buildTodoHubViewModel({ todos = [], projects = [], completedTasks = [], slopeContext = null, currentPlayer = null }) {
  const annotatedTasks = annotateTodos(todos, projects, slopeContext);
  const workload = buildWorkloadModel(annotatedTasks, completedTasks, new Date(), {
    todayProgressMinutes: currentPlayer?.minutesClearedToday,
  });
  const stats = {
    total: annotatedTasks.length,
    overdue: annotatedTasks.filter((task) => task.dueState === 'overdue').length,
    today: annotatedTasks.filter((task) => task.dueState === 'today').length,
    unscheduled: annotatedTasks.filter((task) => task.dueState === 'unscheduled').length,
    scheduled: annotatedTasks.filter((task) => task.dueState !== 'unscheduled').length,
    totalMinutes: annotatedTasks.reduce((sum, task) => sum + Number(task.estimatedDuration || 0), 0),
    scheduledPace: formatPlanningMinutes(workload.scheduledPaceMinutes),
    overdueDebt: formatPlanningMinutes(workload.overdueDebtMinutes),
    backlogPressure: workload.backlogPressure.label,
    remainingWork: formatPlanningMinutes(workload.todayRemainingMinutes),
  };

  const completedRecent = [...completedTasks]
    .filter((task) => task.completedAt)
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
    .slice(0, 30);

  return {
    annotatedTasks,
    projectSummaries: buildProjectSummaries(annotatedTasks, projects),
    workload,
    stats,
    completedRecent,
  };
}
