function feedbackId(prefix, sourceId = '') {
  return `${prefix}:${sourceId || globalThis.crypto?.randomUUID?.() || Date.now()}`;
}

function numericDelta(key, value, label) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount !== 0 ? { key, value: amount, label } : null;
}

export function taskCompletionFeedback(task, result = {}) {
  const deltas = [
    numericDelta('points', result.completedTask?.points ?? result.pointsBase, 'Points'),
    numericDelta('coins', result.tokensGained, 'Coins'),
    numericDelta('contribution', result.reward?.contribution, 'Contribution'),
    numericDelta('goal', result.goalProgressDelta, 'Goal progress'),
    numericDelta('match', result.matchContribution, 'Match'),
    numericDelta('dojo', result.dojoContribution, 'Dojo'),
  ].filter(Boolean);
  return Object.freeze({
    id: feedbackId('task-completed', result.completionEvent?.UUID || task?.UUID),
    type: 'task-completed',
    significance: result.rankChange ? 'major' : deltas.length > 2 ? 'meaningful' : 'routine',
    title: `${task?.name || 'Task'} complete`,
    deltas,
    createdAt: Date.now(),
  });
}

export function simpleMobileFeedback(type, title, {
  significance = 'routine',
  deltas = [],
  sourceId = '',
} = {}) {
  return Object.freeze({
    id: feedbackId(type, sourceId),
    type,
    significance,
    title,
    deltas: deltas.filter(Boolean),
    createdAt: Date.now(),
  });
}

export function mobileFeedbackHapticPattern(significance = 'routine', {
  reducedMotion = false,
} = {}) {
  if (reducedMotion) return null;
  if (significance === 'major') return Object.freeze([24, 40, 36]);
  if (significance === 'meaningful') return 18;
  return 10;
}

export default taskCompletionFeedback;
