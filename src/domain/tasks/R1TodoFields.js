export function normalizeR1TodoFields(todo = {}) {
  const start = todo.startDate ? new Date(todo.startDate) : null;
  if (start && !Number.isFinite(start.getTime())) throw new TypeError('Start date must be a valid date.');
  const minimum = todo.habitMinMinutes == null || todo.habitMinMinutes === '' ? null : Number(todo.habitMinMinutes);
  if (minimum != null && (!Number.isInteger(minimum) || minimum < 1)) throw new TypeError('Habit minimum must be a positive whole number of minutes.');
  return { ...todo, startDate: start?.toISOString() || null, isHabit: todo.isHabit === true, habitMinMinutes: minimum };
}
