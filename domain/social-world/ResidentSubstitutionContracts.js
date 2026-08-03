import {
  CAST_CAPACITY,
  CAST_ROLE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

export const RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION = 1;
export const RESIDENT_PRESENCE_CARD_VERSION = 1;

export const RESIDENT_MODE = Object.freeze({
  fullLive: 'full-live',
  inGameTimeAligned: 'in-game-time-aligned',
  off: 'off',
});

export const OCCUPANT_KIND = Object.freeze({
  familiar: 'familiar',
  resident: 'resident',
});

export const RESIDENT_TIME_BASIS = Object.freeze({
  familiar: 'familiar',
  liveWallClock: 'live-wall-clock',
  viewerIGT: 'viewer-igt',
});

export const RESIDENT_ACTIVITY_CATEGORY = Object.freeze({
  planning: SEMANTIC_LOCATION.planning,
  taskSession: SEMANTIC_LOCATION.taskSession,
  dojo: SEMANTIC_LOCATION.dojo,
  matchArena: SEMANTIC_LOCATION.matchArena,
  marketplace: SEMANTIC_LOCATION.marketplace,
  commons: SEMANTIC_LOCATION.commons,
});

export const RESIDENT_SLOT_PREFIX = Object.freeze({
  friendship: 'friendship:',
  cast: 'cast:',
});

export const RESIDENT_SUBSTITUTION_LIMITS = deepFreeze({
  maxSurroundingProfiles: CAST_CAPACITY.maxSurroundingProfiles,
  heartbeatIntervalMs: 15_000,
  liveFreshnessMs: 45_000,
  familiarOfflineGraceMs: 15_000,
  familiarReclaimObservationGapMs: 10_000,
  residentDisconnectGraceMs: 10_000,
  occupancyRefreshMs: 15_000,
  presentationLeaseMs: 5 * 60_000,
  viewingSessionReentryMs: 2 * 60_000,
  candidateRequestTimeoutMs: 800,
  maxCandidatePool: 20,
  candidateMultiplierPerSlot: 5,
});

export const RESIDENT_RELATIONSHIP_ROLES = Object.freeze([
  CAST_ROLE.friend,
  CAST_ROLE.nearPeer,
  CAST_ROLE.horizon,
]);

const RESIDENT_MODE_SET = new Set(Object.values(RESIDENT_MODE));
const OCCUPANT_KIND_SET = new Set(Object.values(OCCUPANT_KIND));
const RESIDENT_TIME_BASIS_SET = new Set(Object.values(RESIDENT_TIME_BASIS));
const RESIDENT_ACTIVITY_CATEGORY_SET = new Set(Object.values(RESIDENT_ACTIVITY_CATEGORY));
const RESIDENT_RELATIONSHIP_ROLE_SET = new Set(RESIDENT_RELATIONSHIP_ROLES);

export function isResidentMode(value) {
  return RESIDENT_MODE_SET.has(value);
}

export function residentModeAllowsCandidateRetrieval(mode) {
  return isResidentMode(mode) && mode !== RESIDENT_MODE.off;
}

export function isOccupantKind(value) {
  return OCCUPANT_KIND_SET.has(value);
}

export function isResidentTimeBasis(value) {
  return RESIDENT_TIME_BASIS_SET.has(value);
}

export function isResidentActivityCategory(value, { allowGenericActive = false } = {}) {
  if (!RESIDENT_ACTIVITY_CATEGORY_SET.has(value)) return false;
  return allowGenericActive || value !== RESIDENT_ACTIVITY_CATEGORY.commons;
}

export function isResidentRelationshipRole(value) {
  return RESIDENT_RELATIONSHIP_ROLE_SET.has(value);
}

export function isResidentSlotId(value) {
  const id = String(value || '');
  if (id.startsWith(RESIDENT_SLOT_PREFIX.friendship)) {
    return id.length > RESIDENT_SLOT_PREFIX.friendship.length;
  }
  if (!id.startsWith(RESIDENT_SLOT_PREFIX.cast)) return false;
  return [CAST_ROLE.nearPeer, CAST_ROLE.horizon]
    .includes(id.slice(RESIDENT_SLOT_PREFIX.cast.length));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
