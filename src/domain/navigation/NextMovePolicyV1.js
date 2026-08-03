export const NEXT_MOVE_PRIORITY = Object.freeze({
  currentCommitment: 0,
  urgent: 1,
  currentFocus: 2,
  ordinary: 3,
  optional: 4,
});

export function taskPriorityClass(task = {}, now = new Date()) {
  if (task.fixedStartAt || task.explicitCurrentCommitment) {
    return NEXT_MOVE_PRIORITY.currentCommitment;
  }
  const dueAt = task.dueDate || task.dueAt;
  if (dueAt) {
    const due = new Date(dueAt);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    if (Number.isFinite(due.getTime()) && due <= todayEnd) return NEXT_MOVE_PRIORITY.urgent;
  }
  if (task.currentFocus || task.activeMilestone || task.savedContinuation) {
    return NEXT_MOVE_PRIORITY.currentFocus;
  }
  if (task.optional || task.backlogOptional) return NEXT_MOVE_PRIORITY.optional;
  return NEXT_MOVE_PRIORITY.ordinary;
}

export function clarificationShouldPreemptWork(clarification, work) {
  if (!clarification) return false;
  if (!clarification.canImmediatelyUnlock || clarification.failedSinceLastMaterialChange) return false;
  if (!work) return true;
  return Number(clarification.priorityClass) < Number(work.priorityClass);
}

export function usefulTaskFitsWindow(task = {}, availableWindowSeconds = Infinity) {
  if (!Number.isFinite(Number(availableWindowSeconds))) return true;
  const availableMinutes = Math.max(0, Number(availableWindowSeconds) / 60);
  const duration = Math.max(0, Number(task.estimatedDuration) || 0);
  if (!duration) return true;
  if (task.requiresIndivisibleBlock) return duration <= availableMinutes;
  return availableMinutes >= Math.min(duration, Math.max(5, Number(task.minimumUsefulMinutes) || 5));
}
