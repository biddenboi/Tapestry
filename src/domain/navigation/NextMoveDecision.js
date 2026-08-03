import { NEXT_MOVE_CONFIDENCE } from './NextMoveConfidence.js';

export const NEXT_MOVE_RULESET = 'next_move_v1';

export const NEXT_MOVE_RESULT = Object.freeze({
  active: 'active',
  commitment: 'commitment',
  continue: 'continue',
  execute: 'execute',
  clarify: 'clarify',
  reorientDay: 'reorient-day',
  reorientGoal: 'reorient-goal',
  reflect: 'reflect',
  recover: 'recover',
  ask: 'ask',
  none: 'none',
});

function generatedId() {
  return globalThis.crypto?.randomUUID?.()
    || `next-move:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function createNextMoveDecision({
  id = generatedId(),
  playerUUID,
  decisionPoint = 'drawer-open',
  createdAt = new Date().toISOString(),
  resultType,
  phase = resultType,
  title,
  context = '',
  destination = null,
  primaryAction = null,
  reasonCodes = [],
  confidence = NEXT_MOVE_CONFIDENCE.high,
  sourceEntityRefs = [],
  invalidationKeys = [],
  alternatives = [],
  question = null,
  secondaryAction = null,
} = {}) {
  if (!playerUUID) throw new Error('Next Move decisions require a player UUID.');
  if (!Object.values(NEXT_MOVE_RESULT).includes(resultType)) {
    throw new Error(`Unsupported Next Move result: ${resultType || 'missing'}`);
  }
  return Object.freeze({
    UUID: String(id),
    id: String(id),
    parent: String(playerUUID),
    playerUUID: String(playerUUID),
    rulesetVersion: NEXT_MOVE_RULESET,
    decisionPoint,
    createdAt,
    updatedAt: createdAt,
    resultType,
    phase,
    title: String(title || ''),
    context: String(context || ''),
    destination,
    primaryAction,
    reasonCodes: [...new Set(reasonCodes.filter(Boolean))],
    confidence,
    sourceEntityRefs: sourceEntityRefs.filter(Boolean),
    invalidationKeys: [...new Set(invalidationKeys.filter(Boolean))],
    alternatives: alternatives.slice(0, 2),
    question,
    secondaryAction,
    shownAt: null,
    acceptedAt: null,
    dismissedAt: null,
    correctedAt: null,
    resultingActionStartedAt: null,
    outcome: null,
  });
}

export function patchNextMoveDecision(decision, patch = {}) {
  if (!decision?.UUID) throw new Error('A persisted Next Move decision is required.');
  const now = new Date().toISOString();
  return Object.freeze({
    ...decision,
    ...patch,
    UUID: decision.UUID,
    id: decision.id || decision.UUID,
    updatedAt: now,
  });
}
