import {
  CONTEXT_HORIZON,
  PROFILE_CONTEXT_LIMITS,
  createContextProjectionItem,
  emptyProfileContextProjection,
} from './Contracts.js';

const HORIZON_ORDER = Object.freeze({
  [CONTEXT_HORIZON.chapter]: 0,
  [CONTEXT_HORIZON.now]: 1,
  [CONTEXT_HORIZON.near]: 2,
  [CONTEXT_HORIZON.recent]: 3,
  [CONTEXT_HORIZON.goal]: 4,
  [CONTEXT_HORIZON.showUp]: 5,
  [CONTEXT_HORIZON.availability]: 6,
});

function newest(left, right) {
  return Number(HORIZON_ORDER[left.type] ?? 99) - Number(HORIZON_ORDER[right.type] ?? 99)
    || String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''))
    || String(left.UUID || '').localeCompare(String(right.UUID || ''));
}

function take(items, type, limit) {
  return Object.freeze(items.filter((item) => item.type === type).slice(0, limit));
}

export function formatProfileContextProjection({
  viewerId,
  subjectId,
  viewerTier,
  asOfIGT,
  disclosed = [],
} = {}) {
  if (!disclosed.length) {
    return emptyProfileContextProjection({ viewerId, subjectId, viewerTier, asOfIGT });
  }
  const items = disclosed
    .map(({ item, decision }) => createContextProjectionItem(item, { freshness: decision.freshness }))
    .sort(newest)
    .slice(0, PROFILE_CONTEXT_LIMITS.profileItems);
  const chapter = take(items, CONTEXT_HORIZON.chapter, 1)[0] || null;
  const now = take(items, CONTEXT_HORIZON.now, 2);
  const near = take(items, CONTEXT_HORIZON.near, PROFILE_CONTEXT_LIMITS.nearItems);
  const recent = take(items, CONTEXT_HORIZON.recent, PROFILE_CONTEXT_LIMITS.recentItems);
  const goals = take(items, CONTEXT_HORIZON.goal, 3);
  const showUp = take(items, CONTEXT_HORIZON.showUp, 2);
  const availability = take(items, CONTEXT_HORIZON.availability, 1);
  const capsule = Object.freeze([
    chapter,
    now[0],
    near[0],
  ].filter(Boolean).slice(0, PROFILE_CONTEXT_LIMITS.capsuleLines));
  return Object.freeze({
    contractVersion: 1,
    viewerId: String(viewerId || ''),
    subjectId: String(subjectId || ''),
    viewerTier: String(viewerTier || 'outside'),
    asOfIGT: Math.max(0, Number(asOfIGT) || 0),
    reason: 'shared-context',
    chapter,
    now,
    near,
    recent,
    goals,
    showUp,
    availability,
    capsule,
    items: Object.freeze(items),
  });
}

