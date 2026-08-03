import { NEXT_MOVE_REASON } from '../navigation/NextMoveReasonCodes.js';

function overlaps(a, b) {
  const aStart = new Date(a.startAt || a.remindAt || a.dueDate).getTime();
  const aEnd = new Date(a.endAt || (aStart + Number(a.durationMinutes || 0) * 60000)).getTime();
  const bStart = new Date(b.startAt || b.remindAt || b.dueDate).getTime();
  const bEnd = new Date(b.endAt || (bStart + Number(b.durationMinutes || 0) * 60000)).getTime();
  return [aStart, aEnd, bStart, bEnd].every(Number.isFinite) && aStart < bEnd && bStart < aEnd;
}

export function evaluateDayOrientationNeed({
  fixedCommitments = [],
  executableTasks = [],
  urgentTasks = [],
  availableWindowSeconds = Infinity,
  impossibleSuggestionCount = 0,
  availableWindowMateriallyChanged = false,
} = {}) {
  const sorted = [...fixedCommitments].sort((a, b) => (
    new Date(a.startAt || a.remindAt).getTime() - new Date(b.startAt || b.remindAt).getTime()
  ));
  const conflict = sorted.find((entry, index) => (
    index > 0 && overlaps(sorted[index - 1], entry)
  ));
  const noFit = !executableTasks.length
    && Number.isFinite(Number(availableWindowSeconds))
    && Number(availableWindowSeconds) > 0;
  const competingUrgent = urgentTasks.length > 1
    && !urgentTasks.some((task) => task.currentFocus || task.selectedOrder != null);

  if (!conflict && !noFit && !competingUrgent && impossibleSuggestionCount < 2 && !availableWindowMateriallyChanged) {
    return null;
  }
  const reasonCodes = [
    ...(conflict ? [NEXT_MOVE_REASON.scheduleConflict] : []),
    ...(noFit ? [NEXT_MOVE_REASON.noTaskFitsWindow] : []),
    ...(competingUrgent ? [NEXT_MOVE_REASON.competingUrgentTasks] : []),
  ];
  return {
    title: 'Set a workable order for today',
    context: conflict
      ? 'Two fixed commitments overlap. Choose the transition that makes today executable.'
      : competingUrgent
        ? 'Several urgent tasks compete without a selected order.'
        : 'The available window no longer fits the current plan.',
    routeLabel: 'Today → resolve the next scheduling decision',
    reasonCodes,
    invalidationKeys: [
      `commitments:${sorted.map((item) => `${item.UUID}:${item.updatedAt || item.startAt}`).join(',')}`,
      `urgent:${urgentTasks.map((task) => `${task.UUID}:${task.updatedAt || task.dueDate}`).join(',')}`,
    ],
  };
}
