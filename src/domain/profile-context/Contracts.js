export const PROFILE_CONTEXT_CONTRACT_VERSION = 1;

export const CONTEXT_HORIZON = Object.freeze({
  now: 'now',
  near: 'near',
  recent: 'recent',
  chapter: 'chapter',
  showUp: 'show-up',
  goal: 'goal',
  availability: 'availability',
});

export const CONTEXT_AUDIENCE = Object.freeze({
  private: 'private',
  selected: 'selected',
  collaborators: 'collaborators',
  fellows: 'fellows',
  cast: 'cast',
});

export const CONTEXT_STATUS = Object.freeze({
  draft: 'draft',
  active: 'active',
  expired: 'expired',
  revoked: 'revoked',
});

export const CONTEXT_SENSITIVITY = Object.freeze({
  low: 'low',
  personal: 'personal',
  private: 'private',
});

export const CONTEXT_SOURCE = Object.freeze({
  manual: 'manual',
  derived: 'derived',
});

export const CONTEXT_SUGGESTION_STATUS = Object.freeze({
  pending: 'pending',
  accepted: 'accepted',
  dismissed: 'dismissed',
  expired: 'expired',
});

export const PROFILE_CONTEXT_LIMITS = Object.freeze({
  capsuleLines: 3,
  inboxSuggestions: 3,
  nearItems: 3,
  recentItems: 3,
  profileItems: 8,
  primaryDecisions: 4,
  selectedRecipients: 24,
  textLength: 280,
  noteLength: 640,
});

export const DEFAULT_PROFILE_CONTEXT_PREFERENCES = Object.freeze({
  defaultAudience: CONTEXT_AUDIENCE.private,
  defaultTtlHours: 72,
  allowAvailability: false,
  showActivityDetails: false,
  suggestionKinds: Object.freeze([
    'deadline-count',
    'meaningful-completion',
    'return-after-quiet',
    'persistent-blocker',
    'focus-shift',
  ]),
});

export const PROFILE_CONTEXT_ITEM_TYPES = Object.freeze(Object.values(CONTEXT_HORIZON));
export const PROFILE_CONTEXT_AUDIENCES = Object.freeze(Object.values(CONTEXT_AUDIENCE));
export const PROFILE_CONTEXT_STATUSES = Object.freeze(Object.values(CONTEXT_STATUS));
export const PROFILE_CONTEXT_SENSITIVITIES = Object.freeze(Object.values(CONTEXT_SENSITIVITY));

export function emptyProfileContextProjection({
  viewerId = '',
  subjectId = '',
  viewerTier = 'outside',
  asOfIGT = 0,
  reason = 'no-shared-context',
} = {}) {
  return Object.freeze({
    contractVersion: PROFILE_CONTEXT_CONTRACT_VERSION,
    viewerId: String(viewerId || ''),
    subjectId: String(subjectId || ''),
    viewerTier: String(viewerTier || 'outside'),
    asOfIGT: Math.max(0, Number(asOfIGT) || 0),
    reason,
    chapter: null,
    now: Object.freeze([]),
    near: Object.freeze([]),
    recent: Object.freeze([]),
    goals: Object.freeze([]),
    showUp: Object.freeze([]),
    availability: Object.freeze([]),
    capsule: Object.freeze([]),
    items: Object.freeze([]),
  });
}

export function createContextProjectionItem(item, { freshness = null } = {}) {
  return Object.freeze({
    id: String(item.UUID || item.id || ''),
    type: String(item.type || CONTEXT_HORIZON.now),
    text: String(item.text || ''),
    detail: item.detail ? String(item.detail) : null,
    tentative: item.tentative === true,
    source: item.source === CONTEXT_SOURCE.derived ? CONTEXT_SOURCE.derived : CONTEXT_SOURCE.manual,
    audience: String(item.audience || CONTEXT_AUDIENCE.private),
    expiresAt: item.expiresAt || null,
    expiresIGT: item.expiresIGT == null ? null : Math.max(0, Number(item.expiresIGT) || 0),
    freshness,
    actionTarget: item.actionTarget ? Object.freeze({
      type: String(item.actionTarget.type || ''),
      id: String(item.actionTarget.id || ''),
    }) : null,
  });
}

