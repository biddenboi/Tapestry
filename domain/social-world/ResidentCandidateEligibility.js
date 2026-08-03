import {
  RESIDENT_SUBSTITUTION_LIMITS,
  RESIDENT_TIME_BASIS,
  isResidentActivityCategory,
} from './ResidentSubstitutionContracts.js';
import { getRankGroupPresentation } from '../rank/Rank.js';

export const RESIDENT_CANDIDATE_REJECTION = Object.freeze({
  malformedEnvelope: 'malformed-envelope',
  identityUnavailable: 'identity-unavailable',
  profileUnavailable: 'profile-unavailable',
  viewerIdentity: 'viewer-identity',
  primaryFamiliar: 'primary-familiar',
  duplicateOccupant: 'duplicate-occupant',
  outboundDisabled: 'outbound-disabled',
  safetyDenied: 'safety-denied',
  blocked: 'blocked',
  accountIneligible: 'account-ineligible',
  activityIneligible: 'activity-ineligible',
  timeBasisMismatch: 'time-basis-mismatch',
  evidenceExpired: 'evidence-expired',
  provenanceMissing: 'provenance-missing',
});

const SENSITIVE_UNEXPECTED_FIELDS = Object.freeze([
  'objective',
  'taskName',
  'projectName',
  'sourceId',
]);

const PROFILE_IDENTITY_KEYS = Object.freeze([
  'profileId', 'username', 'profilePicture', 'title', 'frame', 'theme', 'rankGroup',
]);

function rejection(reasonCode, diagnostics = []) {
  return Object.freeze({ eligible: false, reasonCode, diagnostics: Object.freeze([...diagnostics]) });
}

function finiteTimestamp(value) {
  const milliseconds = new Date(value || '').getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function publicIdentity(value, profileId) {
  if (!value || typeof value !== 'object' || String(value.profileId || '') !== profileId) return null;
  const prepared = Object.fromEntries(PROFILE_IDENTITY_KEYS.map((key) => [key, value[key] ?? null]));
  prepared.rankGroup = value.rankGroup
    ? getRankGroupPresentation(value.rankGroup).group
    : null;
  if (!prepared.profileId || !String(prepared.username || '').trim()) return null;
  return Object.freeze(prepared);
}

function accountIsIneligible(account = {}) {
  return account.archived === true
    || account.banned === true
    || account.deleted === true
    || account.suspended === true
    || account.bootstrap === true
    || account.restricted === true;
}

export function evaluateResidentCandidate({
  envelope,
  viewerId,
  primaryFamiliarIds = [],
  selectedProfileIds = [],
  ordinaryPublicProfileAvailable = true,
  outboundEnabled,
  canonicalSafetyDecision,
  blockedEitherDirection = false,
  account = {},
  expectedTimeBasis,
  viewerIGT = null,
  nowMs = Date.now(),
  allowGenericActive = false,
} = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.malformedEnvelope);
  }
  const diagnostics = SENSITIVE_UNEXPECTED_FIELDS
    .filter((field) => Object.hasOwn(envelope, field))
    .map((field) => Object.freeze({ code: 'unexpected-field', field, redacted: true }));
  const profileId = String(envelope.profileId || '');
  const identity = publicIdentity(envelope.identity, profileId);
  if (!profileId || !identity) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.identityUnavailable, diagnostics);
  }
  if (!ordinaryPublicProfileAvailable || !String(envelope.profileAccessToken || '')) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.profileUnavailable, diagnostics);
  }
  if (profileId === String(viewerId || '')) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.viewerIdentity, diagnostics);
  }
  if (new Set(primaryFamiliarIds.map(String)).has(profileId)) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.primaryFamiliar, diagnostics);
  }
  if (new Set(selectedProfileIds.map(String)).has(profileId)) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.duplicateOccupant, diagnostics);
  }
  const consent = outboundEnabled ?? envelope.outboundConsent;
  if (consent !== true) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.outboundDisabled, diagnostics);
  }
  const safetyDecision = canonicalSafetyDecision ?? envelope.safetyDecision;
  if (envelope.eligibilityDecision !== 'allow'
      || !String(envelope.eligibilityVersion || '')
      || safetyDecision !== 'allow') {
    return rejection(RESIDENT_CANDIDATE_REJECTION.safetyDenied, diagnostics);
  }
  if (blockedEitherDirection) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.blocked, diagnostics);
  }
  if (accountIsIneligible(account)) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.accountIneligible, diagnostics);
  }
  const activityCategory = envelope.activity?.category;
  if (!isResidentActivityCategory(activityCategory, { allowGenericActive })) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.activityIneligible, diagnostics);
  }
  if (![RESIDENT_TIME_BASIS.liveWallClock, RESIDENT_TIME_BASIS.viewerIGT].includes(expectedTimeBasis)
      || envelope.timeBasis !== expectedTimeBasis) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.timeBasisMismatch, diagnostics);
  }

  const expiresAtMs = finiteTimestamp(envelope.expiresAt);
  let locallyEnforcedExpiryMs = expiresAtMs;
  let elapsedHere = null;
  if (expectedTimeBasis === RESIDENT_TIME_BASIS.liveWallClock) {
    const observedAtMs = finiteTimestamp(envelope.observedAt);
    const freshnessExpiryMs = observedAtMs == null
      ? null
      : observedAtMs + RESIDENT_SUBSTITUTION_LIMITS.liveFreshnessMs;
    locallyEnforcedExpiryMs = freshnessExpiryMs == null || expiresAtMs == null
      ? null
      : Math.min(expiresAtMs, freshnessExpiryMs);
    if (observedAtMs == null || locallyEnforcedExpiryMs == null
        || observedAtMs > nowMs || locallyEnforcedExpiryMs <= nowMs) {
      return rejection(RESIDENT_CANDIDATE_REJECTION.evidenceExpired, diagnostics);
    }
    if (envelope.activity?.startedAt != null) {
      const startedAtMs = finiteTimestamp(envelope.activity.startedAt);
      if (startedAtMs == null || startedAtMs > nowMs) {
        return rejection(RESIDENT_CANDIDATE_REJECTION.activityIneligible, diagnostics);
      }
      elapsedHere = Math.max(0, nowMs - startedAtMs);
    }
  } else {
    const from = Number(envelope.validFromIGT);
    const through = Number(envelope.validThroughIGT);
    const position = Number(viewerIGT);
    if (!Number.isFinite(from) || !Number.isFinite(through) || !Number.isFinite(position)
        || from > position || through <= position || expiresAtMs == null || expiresAtMs <= nowMs) {
      return rejection(RESIDENT_CANDIDATE_REJECTION.evidenceExpired, diagnostics);
    }
    locallyEnforcedExpiryMs = Math.min(expiresAtMs, nowMs + Math.max(0, through - position));
    elapsedHere = Math.max(0, position - from);
  }
  if (envelope.provenance !== 'exact' || !String(envelope.evidenceId || '')) {
    return rejection(RESIDENT_CANDIDATE_REJECTION.provenanceMissing, diagnostics);
  }

  const candidate = Object.freeze({
    profileId,
    identity,
    activity: Object.freeze({ category: activityCategory }),
    timeBasis: envelope.timeBasis,
    evidenceId: String(envelope.evidenceId),
    eligibilityVersion: String(envelope.eligibilityVersion),
    observedAt: envelope.observedAt || null,
    expiresAt: new Date(locallyEnforcedExpiryMs).toISOString(),
    validFromIGT: Number.isFinite(Number(envelope.validFromIGT)) ? Number(envelope.validFromIGT) : null,
    validThroughIGT: Number.isFinite(Number(envelope.validThroughIGT)) ? Number(envelope.validThroughIGT) : null,
    elapsedHere,
    profileAccessToken: String(envelope.profileAccessToken),
  });
  return Object.freeze({ eligible: true, candidate, diagnostics: Object.freeze(diagnostics) });
}

export default evaluateResidentCandidate;
