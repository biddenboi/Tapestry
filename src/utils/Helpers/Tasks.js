import { DAY, MINUTE } from '../Constants.js';
import { getLocalDate } from './Time.js';

export const getTaskDuration = (task) => {
  if (!task?.createdAt || !task?.completedAt) return 0;
  return Math.max(0, new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime());
};

export const getDaysUntilDue = (todo) => {
  if (!todo?.dueDate) return 1;
  const today = getLocalDate(new Date()).getTime();
  const due = getLocalDate(new Date(todo.dueDate)).getTime();
  return Math.max(1, Math.ceil((due - today) / DAY));
};

export const getTodoWPD = (todo) => {
  if (!todo) return 1;
  const estimated = Math.max(1, Number(todo.estimatedDuration) || 1);
  return estimated / getDaysUntilDue(todo);
};

export const getAllWPDFromArray = (data = []) => data.map((t) => getTodoWPD(t));

export const getWeights = (todoArray = []) => {
  if (!todoArray.length) return [];

  const today = getLocalDate(new Date());
  const dueTodayTasks = todoArray.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < today.getTime());

  if (dueTodayTasks.length > 0) {
    dueTodayTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const urgent = dueTodayTasks[0]?.UUID;
    return todoArray.map((t) => (t.UUID === urgent ? 100 : 0));
  }

  const weights = todoArray.map((t) => {
    if (!t.dueDate || !t.estimatedDuration) return 1;
    return getTodoWPD(t);
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return todoArray.map(() => 100 / todoArray.length);
  return weights.map((weight) => (weight / total) * 100);
};

export const getNextTodo = (todoArray = [], weightArray = []) => {
  if (!todoArray.length) return null;
  if (!weightArray.length) return todoArray[0];
  const roll = 1 + Math.random() * 99;
  let remaining = roll;
  let selected = todoArray[todoArray.length - 1];
  for (let i = 0; i < weightArray.length; i += 1) {
    remaining -= weightArray[i];
    if (remaining <= 0) {
      selected = todoArray[i];
      break;
    }
  }
  return selected;
};

export const getSessionMultiplier = (duration, estimatedDuration) => {
  if (estimatedDuration <= 0 || estimatedDuration == null) return 0;
  return Math.exp(-2 * Math.pow(duration - estimatedDuration, 2) / (2 * Math.pow(estimatedDuration, 2)));
};

export const getGaussianCurvePoints = (estimatedDurationMs, count = 240) => {
  if (!estimatedDurationMs || estimatedDurationMs <= 0) return [{ x: 0, y: 0 }];
  const maxX = estimatedDurationMs * 2.4;
  return Array.from({ length: count + 1 }, (_, index) => {
    const x = (index / count) * maxX;
    return { x, y: getSessionMultiplier(x, estimatedDurationMs) };
  });
};

export const sessionDurationToMs = (minutes) => Math.max(0, Number(minutes || 0)) * MINUTE;
