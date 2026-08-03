import {
  CAST_ROLE,
  PRESENCE_STATE,
} from './SocialWorldContracts.js';
import { buildProfileIdentity } from '../profile/ProfileIdentity.js';
import {
  OCCUPANT_KIND,
  RESIDENT_MODE,
  RESIDENT_SLOT_PREFIX,
  RESIDENT_SUBSTITUTION_LIMITS,
  RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION,
  RESIDENT_TIME_BASIS,
  isResidentMode,
  isResidentRelationshipRole,
  isResidentSlotId,
} from './ResidentSubstitutionContracts.js';
import { assertResidentPresenceCard } from './ResidentPresenceCard.js';

export const RESIDENT_POLICY_DIAGNOSTIC = Object.freeze({
  capacityViolation: 'capacity-violation',
  duplicatePrimaryFamiliar: 'duplicate-primary-familiar',
  invalidSlot: 'invalid-slot',
});

function asId(value) {
  return String(value ?? '').trim();
}

function friendshipId(entry, profileId) {
  return asId(
    entry?.relationship?.UUID
    || entry?.relationship?.id
    || entry?.friendshipId
    || entry?.relationshipId
    || profileId,
  );
}

function familiarProfile(entry) {
  return entry?.profile || entry || null;
}

function familiarId(entry) {
  return asId(
    entry?.subjectId
    || entry?.UUID
    || entry?.id
    || entry?.profile?.profileId
    || entry?.profile?.UUID
    || entry?.profile?.id,
  );
}

function slotForFriend(entry) {
  const profileId = familiarId(entry);
  if (!profileId) return null;
  const relationshipId = friendshipId(entry, profileId);
  return Object.freeze({
    slotId: `${RESIDENT_SLOT_PREFIX.friendship}${relationshipId}`,
    relationshipRole: CAST_ROLE.friend,
    primaryFamiliarId: profileId,
    primaryFamiliar: Object.freeze({
      profileId,
      profile: familiarProfile(entry),
    }),
  });
}

function slotForDynamic(entry) {
  const profileId = familiarId(entry);
  const role = entry?.role;
  if (!profileId || ![CAST_ROLE.nearPeer, CAST_ROLE.horizon].includes(role)) return null;
  return Object.freeze({
    slotId: `${RESIDENT_SLOT_PREFIX.cast}${role}`,
    relationshipRole: role,
    primaryFamiliarId: profileId,
    primaryFamiliar: Object.freeze({
      profileId,
      profile: familiarProfile(entry),
    }),
  });
}

function policyError(code, message, details) {
  const error = new TypeError(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

export function buildPrimaryFamiliarSlots(residency = {}, {
  strict = true,
  onDiagnostic = null,
} = {}) {
  const candidates = [
    ...(residency?.friends || []).map(slotForFriend),
    ...(residency?.dynamic || []).map(slotForDynamic),
  ].filter(Boolean);

  const slots = [];
  const profileIds = new Set();
  const slotIds = new Set();
  for (const candidate of candidates) {
    if (!isResidentSlotId(candidate.slotId)
        || !isResidentRelationshipRole(candidate.relationshipRole)
        || slotIds.has(candidate.slotId)) {
      const diagnostic = Object.freeze({
        code: RESIDENT_POLICY_DIAGNOSTIC.invalidSlot,
        slotId: candidate.slotId,
        primaryFamiliarId: candidate.primaryFamiliarId,
      });
      onDiagnostic?.(diagnostic);
      if (strict) throw policyError(diagnostic.code, 'Primary familiar slot is invalid or duplicated.', diagnostic);
      continue;
    }
    if (profileIds.has(candidate.primaryFamiliarId)) {
      const diagnostic = Object.freeze({
        code: RESIDENT_POLICY_DIAGNOSTIC.duplicatePrimaryFamiliar,
        slotId: candidate.slotId,
        primaryFamiliarId: candidate.primaryFamiliarId,
      });
      onDiagnostic?.(diagnostic);
      if (strict) throw policyError(diagnostic.code, 'A primary familiar cannot own multiple visible slots.', diagnostic);
      continue;
    }
    slots.push(candidate);
    profileIds.add(candidate.primaryFamiliarId);
    slotIds.add(candidate.slotId);
  }

  if (slots.length > RESIDENT_SUBSTITUTION_LIMITS.maxSurroundingProfiles) {
    const diagnostic = Object.freeze({
      code: RESIDENT_POLICY_DIAGNOSTIC.capacityViolation,
      requestedCount: slots.length,
      maximum: RESIDENT_SUBSTITUTION_LIMITS.maxSurroundingProfiles,
    });
    onDiagnostic?.(diagnostic);
    if (strict) throw policyError(diagnostic.code, 'The familiar circle exceeds presentation capacity.', diagnostic);
  }

  return Object.freeze(slots.slice(0, RESIDENT_SUBSTITUTION_LIMITS.maxSurroundingProfiles));
}

function observationTime(value) {
  const source = value?.observedAtMs ?? value?.observedAt;
  if (Number.isFinite(Number(source))) return Number(source);
  const parsed = new Date(source || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isFreshLivePresence(presence, nowMs, {
  includeOfflineGrace = false,
} = {}) {
  if (!presence || presence.active === false) return false;
  const observedAt = observationTime(presence);
  const now = Number(nowMs);
  if (observedAt == null || !Number.isFinite(now) || observedAt > now) return false;
  const freshness = RESIDENT_SUBSTITUTION_LIMITS.liveFreshnessMs
    + (includeOfflineGrace ? RESIDENT_SUBSTITUTION_LIMITS.familiarOfflineGraceMs : 0);
  return now - observedAt <= freshness;
}

export function isAlignedFamiliarRepresentable(presence, { evidenceResolved = true } = {}) {
  if (!evidenceResolved) return true;
  return [PRESENCE_STATE.current, PRESENCE_STATE.projected, PRESENCE_STATE.recent]
    .includes(presence?.state);
}

export function isPrimaryFamiliarRepresentable({
  mode,
  livePresence = null,
  alignedPresence = null,
  liveEvidenceResolved = true,
  alignedEvidenceResolved = true,
  nowMs = Date.now(),
} = {}) {
  if (!isResidentMode(mode)) throw new TypeError(`Unsupported resident mode: ${mode}`);
  if (mode === RESIDENT_MODE.off) return true;
  if (mode === RESIDENT_MODE.fullLive) {
    if (!liveEvidenceResolved) return true;
    return isFreshLivePresence(livePresence, nowMs, { includeOfflineGrace: true });
  }
  return isAlignedFamiliarRepresentable(alignedPresence, {
    evidenceResolved: alignedEvidenceResolved,
  });
}

export function isFamiliarSlotSubstitutable(input = {}) {
  return input.mode !== RESIDENT_MODE.off
    && !isPrimaryFamiliarRepresentable(input);
}

function primaryOccupant(slot, presence = null) {
  const profile = slot.primaryFamiliar?.profile || { profileId: slot.primaryFamiliarId };
  return Object.freeze({
    kind: OCCUPANT_KIND.familiar,
    profileId: slot.primaryFamiliarId,
    identity: buildProfileIdentity({ ...profile, profileId: slot.primaryFamiliarId }),
    presence,
    timeBasis: RESIDENT_TIME_BASIS.familiar,
    residentCard: null,
  });
}

export function buildPrimaryOnlyOccupancySnapshot({
  viewerId,
  viewerIGT = 0,
  mode = RESIDENT_MODE.off,
  primarySlots = [],
  presences = {},
  snapshotId = `primary:${asId(viewerId)}:${Math.max(0, Number(viewerIGT) || 0)}`,
  viewingSessionId = null,
  resolvedAt = new Date().toISOString(),
} = {}) {
  if (!asId(viewerId)) throw new TypeError('An occupancy snapshot requires a viewer.');
  if (!isResidentMode(mode)) throw new TypeError(`Unsupported resident mode: ${mode}`);
  const slots = primarySlots.map((slot) => Object.freeze({
    slotId: slot.slotId,
    relationshipRole: slot.relationshipRole,
    primaryFamiliarId: slot.primaryFamiliarId,
    occupant: primaryOccupant(slot, presences[slot.primaryFamiliarId] || null),
  }));
  const timestamp = new Date(resolvedAt).getTime();
  const resolvedAtISO = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
  return Object.freeze({
    schemaVersion: RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION,
    snapshotId: String(snapshotId),
    viewingSessionId: viewingSessionId == null ? null : String(viewingSessionId),
    viewerId: asId(viewerId),
    viewerIGT: Math.max(0, Math.trunc(Number(viewerIGT) || 0)),
    mode,
    resolvedAt: resolvedAtISO,
    refreshAfter: null,
    expiresAt: null,
    slots: Object.freeze(slots),
  });
}

export function assertResidentOccupancySnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION
      || !snapshot.viewerId || !isResidentMode(snapshot.mode)
      || !Array.isArray(snapshot.slots)
      || snapshot.slots.length > RESIDENT_SUBSTITUTION_LIMITS.maxSurroundingProfiles) {
    throw policyError(
      RESIDENT_POLICY_DIAGNOSTIC.capacityViolation,
      'Resident occupancy snapshot violates its root contract.',
      { slotCount: snapshot?.slots?.length ?? null },
    );
  }
  const slotIds = new Set();
  const occupantIds = new Set();
  for (const slot of snapshot.slots) {
    if (!isResidentSlotId(slot?.slotId)
        || !isResidentRelationshipRole(slot?.relationshipRole)
        || !slot?.primaryFamiliarId
        || slotIds.has(slot.slotId)
        || !slot?.occupant?.profileId
        || occupantIds.has(slot.occupant.profileId)) {
      throw policyError(RESIDENT_POLICY_DIAGNOSTIC.invalidSlot, 'Resident occupancy slot is invalid.', {
        slotId: slot?.slotId || null,
      });
    }
    if (slot.occupant.kind === OCCUPANT_KIND.familiar) {
      if (slot.occupant.profileId !== slot.primaryFamiliarId
          || slot.occupant.timeBasis !== RESIDENT_TIME_BASIS.familiar
          || slot.occupant.residentCard !== null) {
        throw policyError(RESIDENT_POLICY_DIAGNOSTIC.invalidSlot, 'Familiar occupancy changed slot ownership.', {
          slotId: slot.slotId,
        });
      }
    } else if (slot.occupant.kind === OCCUPANT_KIND.resident) {
      if (slot.occupant.profileId === slot.primaryFamiliarId) {
        throw policyError(RESIDENT_POLICY_DIAGNOSTIC.invalidSlot, 'A primary familiar cannot be its own resident.', {
          slotId: slot.slotId,
        });
      }
      assertResidentPresenceCard(slot.occupant.residentCard);
      if (slot.occupant.residentCard.profileId !== slot.occupant.profileId
          || slot.occupant.residentCard.timeBasis !== slot.occupant.timeBasis) {
        throw policyError(RESIDENT_POLICY_DIAGNOSTIC.invalidSlot, 'Resident occupant and card disagree.', {
          slotId: slot.slotId,
        });
      }
    } else {
      throw policyError(RESIDENT_POLICY_DIAGNOSTIC.invalidSlot, 'Occupant kind is unsupported.', {
        slotId: slot.slotId,
      });
    }
    slotIds.add(slot.slotId);
    occupantIds.add(slot.occupant.profileId);
  }
  return true;
}

export default buildPrimaryFamiliarSlots;
