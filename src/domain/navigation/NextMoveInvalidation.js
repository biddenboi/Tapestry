export function nextMoveInvalidationSignature(keys = []) {
  return [...new Set(keys.filter(Boolean).map(String))].sort().join('|');
}

export function isNextMoveDecisionSuppressed(decision, feedback = []) {
  if (!decision?.UUID) return false;
  return feedback.some((entry) => (
    String(entry.decisionId) === String(decision.UUID)
    && entry.type === 'not-now'
  ));
}

export function isNextMoveDecisionStillValid(decision, currentKeys = []) {
  if (!decision?.UUID || decision.outcome === 'invalidated') return false;
  return nextMoveInvalidationSignature(decision.invalidationKeys)
    === nextMoveInvalidationSignature(currentKeys);
}

export function materialStateKey(type, entity = {}) {
  const identity = entity.UUID || entity.id || 'none';
  const revision = entity.taskRevisionHash
    || entity.updatedAt
    || entity.status
    || entity.phase
    || entity.completedAt
    || 'stable';
  return `${type}:${identity}:${revision}`;
}
