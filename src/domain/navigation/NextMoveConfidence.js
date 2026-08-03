export const NEXT_MOVE_CONFIDENCE = Object.freeze({
  high: 'high',
  medium: 'medium',
  low: 'low',
});

export function deriveNextMoveConfidence({
  requiredFactsKnown = true,
  hasConflictingState = false,
  correctedRule = false,
  destinationReliable = true,
  questionWouldChangeResult = false,
} = {}) {
  if (questionWouldChangeResult) return NEXT_MOVE_CONFIDENCE.medium;
  if (!requiredFactsKnown || hasConflictingState || correctedRule || !destinationReliable) {
    return NEXT_MOVE_CONFIDENCE.low;
  }
  return NEXT_MOVE_CONFIDENCE.high;
}
