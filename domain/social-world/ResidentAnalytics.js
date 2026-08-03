import {
  normalizeAnalyticsEvent,
  recordAnalyticsEvent,
} from '../analytics/AnalyticsEvents.js';
import {
  RESIDENT_ACTIVITY_CATEGORY,
  RESIDENT_MODE,
  RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION,
  RESIDENT_TIME_BASIS,
} from './ResidentSubstitutionContracts.js';

export const RESIDENT_ANALYTICS_EVENT = Object.freeze({
  modeViewed: 'resident_mode_viewed',
  modeChanged: 'resident_mode_changed',
  outboundChanged: 'resident_outbound_changed',
  slotEligible: 'resident_slot_eligible',
  occupancyStarted: 'resident_occupancy_started',
  occupancyEnded: 'resident_occupancy_ended',
  cardRendered: 'resident_card_rendered',
  publicProfileOpened: 'resident_public_profile_opened',
  familiarContinuityOpened: 'familiar_continuity_opened',
  educationShown: 'resident_education_shown',
  educationDismissed: 'resident_education_dismissed',
});

export const RESIDENT_OCCUPANCY_END_REASON = Object.freeze({
  familiarReturned: 'familiar-returned',
  activityExpired: 'activity-expired',
  privacyWithdrawn: 'privacy-withdrawn',
  blocked: 'blocked',
  moderated: 'moderated',
  modeChanged: 'mode-changed',
  slotRemoved: 'slot-removed',
  sessionEnded: 'session-ended',
  gatewayFailed: 'gateway-failed',
  killSwitch: 'kill-switch',
  other: 'other',
});

export const RESIDENT_ANALYTICS_SURFACE = Object.freeze({
  settings: 'settings',
  provider: 'provider',
  occupancyService: 'occupancy-service',
  socialWorld: 'social-world',
  tavern: 'tavern',
  lobbyMatch: 'lobby-match',
  lobbyDojo: 'lobby-dojo',
  lobby: 'lobby',
  dojo: 'dojo',
  profile: 'profile',
  familiarContinuity: 'familiar-continuity',
});

const ALLOWED_METADATA = new Set([
  'mode',
  'timeBasis',
  'activityCategory',
  'surface',
  'slotRole',
  'reasonCode',
  'snapshotSchemaVersion',
  'occupancyAgeBucket',
  'candidateCountBucket',
  'featureCohort',
]);
const EVENT_SET = new Set(Object.values(RESIDENT_ANALYTICS_EVENT));
const SURFACE_SET = new Set(Object.values(RESIDENT_ANALYTICS_SURFACE));
const MODE_SET = new Set(Object.values(RESIDENT_MODE));
const TIME_BASIS_SET = new Set(Object.values(RESIDENT_TIME_BASIS));
const ACTIVITY_SET = new Set(Object.values(RESIDENT_ACTIVITY_CATEGORY));
const SLOT_ROLE_SET = new Set(['friend', 'near-peer', 'horizon']);
const AGE_BUCKET_SET = new Set(['under-15s', '15-44s', '45s-plus', 'unknown']);
const COUNT_BUCKET_SET = new Set(['0', '1', '2-5', '6-10', '11-20']);

function optionalEnum(value, allowed, label) {
  if (value == null) return null;
  const normalized = String(value);
  if (!allowed.has(normalized)) throw new TypeError(`Invalid resident analytics ${label}.`);
  return normalized;
}

export function normalizeResidentOccupancyEndReason(reasonCode) {
  const normalized = String(reasonCode || '');
  return Object.values(RESIDENT_OCCUPANCY_END_REASON).includes(normalized)
    ? normalized
    : RESIDENT_OCCUPANCY_END_REASON.other;
}

export function residentOccupancyAgeBucket(ageMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  if (age < 15_000) return 'under-15s';
  if (age < 45_000) return '15-44s';
  return '45s-plus';
}

export function residentCandidateCountBucket(count) {
  const value = Math.max(0, Math.trunc(Number(count) || 0));
  if (value === 0) return '0';
  if (value === 1) return '1';
  if (value <= 5) return '2-5';
  if (value <= 10) return '6-10';
  return '11-20';
}

export function sanitizeResidentAnalyticsMetadata(metadata = {}, { surface } = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('Resident analytics metadata must be an object.');
  }
  for (const key of Object.keys(metadata)) {
    if (!ALLOWED_METADATA.has(key)) {
      throw new TypeError(`Resident analytics metadata is not allowed: ${key}`);
    }
  }
  const preparedSurface = optionalEnum(metadata.surface || surface, SURFACE_SET, 'surface');
  if (!preparedSurface) throw new TypeError('Resident analytics requires a known surface.');
  const prepared = { surface: preparedSurface };
  const mode = optionalEnum(metadata.mode, MODE_SET, 'mode');
  const timeBasis = optionalEnum(metadata.timeBasis, TIME_BASIS_SET, 'time basis');
  const activityCategory = optionalEnum(metadata.activityCategory, ACTIVITY_SET, 'activity category');
  const slotRole = optionalEnum(metadata.slotRole, SLOT_ROLE_SET, 'slot role');
  const ageBucket = optionalEnum(metadata.occupancyAgeBucket, AGE_BUCKET_SET, 'occupancy age bucket');
  const countBucket = optionalEnum(metadata.candidateCountBucket, COUNT_BUCKET_SET, 'candidate count bucket');
  if (mode) prepared.mode = mode;
  if (timeBasis) prepared.timeBasis = timeBasis;
  if (activityCategory) prepared.activityCategory = activityCategory;
  if (slotRole) prepared.slotRole = slotRole;
  if (metadata.reasonCode != null) {
    prepared.reasonCode = normalizeResidentOccupancyEndReason(metadata.reasonCode);
  }
  if (metadata.snapshotSchemaVersion != null) {
    const version = Math.trunc(Number(metadata.snapshotSchemaVersion));
    if (!Number.isFinite(version) || version < 1) {
      throw new TypeError('Invalid resident analytics snapshot schema version.');
    }
    prepared.snapshotSchemaVersion = version;
  }
  if (ageBucket) prepared.occupancyAgeBucket = ageBucket;
  if (countBucket) prepared.candidateCountBucket = countBucket;
  if (metadata.featureCohort != null) {
    const cohort = String(metadata.featureCohort);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(cohort)) {
      throw new TypeError('Invalid resident analytics feature cohort.');
    }
    prepared.featureCohort = cohort;
  }
  return Object.freeze(prepared);
}

export function createResidentAnalyticsEvent({
  eventName,
  surface,
  viewerId,
  subjectId = null,
  metadata = {},
  createdAt = new Date().toISOString(),
} = {}) {
  if (!EVENT_SET.has(eventName)) throw new TypeError('Unknown resident analytics event.');
  if (!viewerId) throw new TypeError('Resident analytics requires an internal viewer ID.');
  const preparedMetadata = sanitizeResidentAnalyticsMetadata(metadata, { surface });
  return Object.freeze({
    parent: String(viewerId),
    eventName,
    surface: preparedMetadata.surface,
    targetType: subjectId ? 'profile' : null,
    targetUUID: subjectId ? String(subjectId) : null,
    metadata: preparedMetadata,
    createdAt,
  });
}

export async function recordResidentAnalyticsEvent(
  databaseConnection,
  currentPlayer,
  event,
  options = {},
) {
  if (!databaseConnection || !currentPlayer?.UUID) return null;
  const normalized = createResidentAnalyticsEvent({
    ...event,
    viewerId: currentPlayer.UUID,
    metadata: {
      snapshotSchemaVersion: RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION,
      ...(event?.metadata || {}),
    },
  });
  const persisted = normalizeAnalyticsEvent(normalized, currentPlayer);
  if (typeof databaseConnection.recordResidentAnalyticsEvent === 'function') {
    return databaseConnection.recordResidentAnalyticsEvent(persisted, options);
  }
  return recordAnalyticsEvent(databaseConnection, currentPlayer, persisted, options);
}

export default recordResidentAnalyticsEvent;
