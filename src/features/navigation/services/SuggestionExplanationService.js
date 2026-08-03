import { explainNextMoveReasons } from '../../../domain/navigation/NextMoveReasonCodes.js';

export function buildSuggestionExplanation(decision = {}) {
  const reasons = explainNextMoveReasons(decision.reasonCodes);
  const first = reasons[0]?.text || 'The current state created a useful decision point.';
  const second = reasons[1]?.text || 'This is the smallest useful intervention supported by the available evidence.';
  const unlock = {
    active: 'Continued control of the work already in progress.',
    commitment: 'A timely transition into the fixed commitment.',
    continue: 'Restoration of the exact state you preserved.',
    execute: 'Useful real-world progress without reopening planning.',
    clarify: 'One executable next visible action.',
    'reorient-day': 'A workable immediate order for today.',
    'reorient-goal': 'A current milestone that can generate useful tasks.',
    reflect: 'A factual record of what changed.',
    recover: 'A deliberate transition out of sustained effort.',
    ask: 'The missing fact needed to choose safely.',
    none: 'Space to continue without unnecessary intervention.',
  }[decision.resultType] || 'A clear next step.';
  return Object.freeze({
    whyNow: first,
    whyThis: second,
    whatItUnlocks: unlock,
    reasons,
  });
}
