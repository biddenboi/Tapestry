const WEEKDAY_INDEX = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
});

const RECURRENCE_PATTERNS = [
  /\b(every\s+(\d+)\s+(days?|weeks?|months?))\b/i,
  /\b(every\s+(day|weekday|week|month))\b/i,
  /\b(every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i,
  /\b(daily|weekly|monthly)\b/i,
];

function normalizedRule(match) {
  const phrase = match[0].trim().toLowerCase();
  const count = Number(match[2]);
  const unit = String(match[3] || match[2] || phrase).toLowerCase();
  if (Object.hasOwn(WEEKDAY_INDEX, unit)) {
    return { frequency: 'week', interval: 1, weekdays: [WEEKDAY_INDEX[unit]], phrase };
  }
  if (unit === 'weekday') {
    return { frequency: 'day', interval: 1, weekdays: [1, 2, 3, 4, 5], phrase };
  }
  const frequency = unit.startsWith('week') || phrase === 'weekly'
    ? 'week'
    : unit.startsWith('month') || phrase === 'monthly'
      ? 'month'
      : 'day';
  return {
    frequency,
    interval: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    weekdays: null,
    phrase,
  };
}

export function parseTaskRecurrence(input = '') {
  const text = String(input);
  for (const pattern of RECURRENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    return {
      recurrence: normalizedRule(match),
      range: [match.index, match.index + match[0].length],
    };
  }
  return { recurrence: null, range: null };
}

export function formatTaskRecurrence(rule = null) {
  if (!rule) return '';
  if (rule.phrase) return rule.phrase;
  if (Array.isArray(rule.weekdays) && rule.weekdays.length === 1) {
    const name = Object.keys(WEEKDAY_INDEX).find((key) => WEEKDAY_INDEX[key] === rule.weekdays[0]);
    return name ? `every ${name}` : 'every week';
  }
  if (Array.isArray(rule.weekdays) && rule.weekdays.join(',') === '1,2,3,4,5') return 'every weekday';
  const interval = Math.max(1, Number(rule.interval) || 1);
  const unit = rule.frequency === 'month' ? 'month' : rule.frequency === 'week' ? 'week' : 'day';
  return interval === 1 ? `every ${unit}` : `every ${interval} ${unit}s`;
}

function validDate(value, fallback = new Date()) {
  const date = new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date : new Date(fallback);
}

function addMonthsPreservingDay(date, months, anchorDay = date.getDate()) {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const finalDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(Math.max(1, Number(anchorDay) || date.getDate()), finalDay));
  return next;
}

function advanceOnce(date, rule) {
  if (Array.isArray(rule.weekdays) && rule.weekdays.length) {
    const allowed = new Set(rule.weekdays.map(Number));
    const next = new Date(date);
    do next.setDate(next.getDate() + 1); while (!allowed.has(next.getDay()));
    return next;
  }
  if (rule.frequency === 'month') {
    return addMonthsPreservingDay(
      date,
      Math.max(1, Number(rule.interval) || 1),
      rule.anchorDay || date.getDate(),
    );
  }
  const days = (rule.frequency === 'week' ? 7 : 1) * Math.max(1, Number(rule.interval) || 1);
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function nextTaskOccurrence(task = {}, completedAt = new Date()) {
  const rule = task.recurrence || task.repeatRule || null;
  if (!rule) return null;
  const completed = validDate(completedAt);
  const scheduled = validDate(task.dueDate, completed);
  const normalizedRule = ruleWithAnchor(rule, scheduled);
  let next = advanceOnce(scheduled, normalizedRule);
  for (let guard = 0; guard < 400 && next.getTime() <= completed.getTime(); guard += 1) {
    next = advanceOnce(next, normalizedRule);
  }
  return next;
}

export function advanceRecurringTodo(task = {}, completedAt = new Date()) {
  const next = nextTaskOccurrence(task, completedAt);
  if (!next) return null;
  const completed = validDate(completedAt);
  return {
    ...task,
    dueDate: next.toISOString(),
    lastCompletedAt: completed.toISOString(),
    recurrence: ruleWithAnchor(task.recurrence || task.repeatRule, task.dueDate || completed),
  };
}

export function ruleWithAnchor(rule = null, dueDate = null) {
  if (!rule || rule.frequency !== 'month' || rule.anchorDay) return rule;
  return { ...rule, anchorDay: validDate(dueDate).getDate() };
}
