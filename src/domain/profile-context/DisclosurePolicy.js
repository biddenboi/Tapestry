import {
  CONTEXT_AUDIENCE,
  CONTEXT_SENSITIVITY,
  CONTEXT_STATUS,
} from './Contracts.js';
import { contextFreshness } from './Freshness.js';

const SENSITIVITY_RANK = Object.freeze({
  [CONTEXT_SENSITIVITY.low]: 0,
  [CONTEXT_SENSITIVITY.personal]: 1,
  [CONTEXT_SENSITIVITY.private]: 2,
});

const TIER_CEILING = Object.freeze({
  self: CONTEXT_SENSITIVITY.private,
  friend: CONTEXT_SENSITIVITY.personal,
  dynamic: CONTEXT_SENSITIVITY.low,
  outside: null,
});

function audienceAllows(audience, tier, viewerId, recipients) {
  if (tier === 'self') return true;
  if (audience === CONTEXT_AUDIENCE.private) return false;
  if (audience === CONTEXT_AUDIENCE.selected) return recipients.has(String(viewerId || ''));
  if (audience === CONTEXT_AUDIENCE.collaborators) return tier === 'friend';
  if (audience === CONTEXT_AUDIENCE.fellows) return tier === 'dynamic';
  if (audience === CONTEXT_AUDIENCE.cast) return tier === 'friend' || tier === 'dynamic';
  return false;
}

export function evaluateContextDisclosure(item, {
  viewerId,
  subjectId,
  relationshipTier = 'outside',
  recipientIds = [],
  preferences = {},
  asOf = new Date(),
  asOfIGT = 0,
} = {}) {
  const tier = String(viewerId || '') === String(subjectId || '') ? 'self' : relationshipTier;
  if (!item || item.status !== CONTEXT_STATUS.active) {
    return Object.freeze({ allowed: false, reason: item?.status || 'missing', tier });
  }
  const freshness = contextFreshness(item, { asOf, asOfIGT });
  if (!freshness.fresh) return Object.freeze({ allowed: false, reason: freshness.reason, tier, freshness });
  const recipients = new Set([
    ...(recipientIds || []),
    ...(item.recipientIds || []),
  ].map(String));
  if (!audienceAllows(item.audience, tier, viewerId, recipients)) {
    return Object.freeze({ allowed: false, reason: 'audience', tier, freshness });
  }
  if (item.sourceVisibility
      && !audienceAllows(item.sourceVisibility, tier, viewerId, recipients)) {
    return Object.freeze({ allowed: false, reason: 'source-visibility', tier, freshness });
  }
  const ceiling = TIER_CEILING[tier];
  if (ceiling == null || (SENSITIVITY_RANK[item.sensitivity] ?? 2) > SENSITIVITY_RANK[ceiling]) {
    return Object.freeze({ allowed: false, reason: 'sensitivity', tier, freshness });
  }
  if (item.type === 'availability' && preferences.allowAvailability !== true) {
    return Object.freeze({ allowed: false, reason: 'availability-opt-out', tier, freshness });
  }
  return Object.freeze({ allowed: true, reason: 'allowed', tier, freshness });
}

export function filterDisclosedContextItems(items = [], options = {}) {
  return items.flatMap((item) => {
    const decision = evaluateContextDisclosure(item, options);
    return decision.allowed ? [{ item, decision }] : [];
  });
}

