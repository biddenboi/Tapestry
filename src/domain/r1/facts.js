// Observable inputs only (Lot model.rs:65-84); date/recurrence conversion is supplied by the app.
export function factsFromTodo(todo, { toHours, cycleHours = null } = {}) {
  if (!todo?.UUID || !todo.dueDate || todo.deletedAt || todo.archivedAt) return null;
  const q = Number(todo.isHabit ? todo.habitMinMinutes ?? todo.estimatedDuration : todo.estimatedDuration) / 60;
  const d = toHours(todo.dueDate); const start = todo.startDate ? toHours(todo.startDate) : null;
  if (!Number.isFinite(q) || q < 0 || !Number.isFinite(d) || (start != null && !Number.isFinite(start))) return null;
  return { id: String(todo.UUID), q, l: Number(todo.r1LoggedMinutes || 0) / 60, d, start,
    cycle: cycleHours, habit: todo.isHabit === true, category: todo.projectId ? String(todo.projectId) : null,
    block: Number(todo.minimumBlockMinutes || 0) / 60, after: todo.afterTaskId ? String(todo.afterTaskId) : null,
    completed: Boolean(todo.completedAt) };
}
