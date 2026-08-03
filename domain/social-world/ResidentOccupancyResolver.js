import {
  PRESENCE_CLAIM,
  PRESENCE_STATE,
} from './SocialWorldContracts.js';
import {
  RESIDENT_MODE,
  RESIDENT_SUBSTITUTION_LIMITS,
  RESIDENT_TIME_BASIS,
  isResidentMode,
} from './ResidentSubstitutionContracts.js';
import {
  assertResidentOccupancySnapshot,
  buildPrimaryOnlyOccupancySnapshot,
  isPrimaryFamiliarRepresentable,
} from './ResidentSubstitutionPolicy.js';
import { buildResidentOccupant, buildResidentPresenceCard } from './ResidentPresenceCard.js';

export const RESIDENT_OCCUPANCY_DIAGNOSTIC = Object.freeze({
  evidenceUnresolved: 'familiar-evidence-unresolved',
  familiarRepresentable: 'familiar-representable',
  familiarReclaimPending: 'familiar-reclaim-pending',
  familiarReclaimed: 'familiar-reclaimed',
  noEligibleCandidate: 'no-eligible-candidate',
  incumbentRetained: 'incumbent-retained',
  incumbentGraceRetained: 'incumbent-grace-retained',
  residentAssigned: 'resident-assigned',
});

function timestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(milliseconds) {
  return new Date(Math.max(0, Number(milliseconds) || 0)).toISOString();
}

export function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function freshnessBucket(candidate, nowMs) {
  if (candidate.timeBasis !== RESIDENT_TIME_BASIS.liveWallClock) return 0;
  const observedAt = timestamp(candidate.observedAt);
  if (observedAt == null) return 2;
  return Math.max(0, Math.min(2, Math.floor((nowMs - observedAt)
    / RESIDENT_SUBSTITUTION_LIMITS.heartbeatIntervalMs)));
}

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function candidateTuple(candidate, {
  viewerId,
  selectionSeed,
  incumbentProfileId,
  recentResidentProfileIds,
  nowMs,
} = {}) {
  return [
    freshnessBucket(candidate, nowMs),
    candidate.profileId === incumbentProfileId ? 0 : 1,
    recentResidentProfileIds.has(candidate.profileId) ? 1 : 0,
    fnv1a32(`${viewerId}|${selectionSeed}|${candidate.profileId}`),
  ];
}

function residentPresence(candidate) {
  return Object.freeze({
    intervalId: candidate.evidenceId,
    state: candidate.timeBasis === RESIDENT_TIME_BASIS.viewerIGT
      ? PRESENCE_STATE.projected
      : PRESENCE_STATE.current,
    location: candidate.activity.category,
    claim: candidate.timeBasis === RESIDENT_TIME_BASIS.viewerIGT
      ? PRESENCE_CLAIM.recordedInterval
      : PRESENCE_CLAIM.exactCurrent,
    elapsedHere: Number.isFinite(Number(candidate.elapsedHere))
      ? Math.max(0, Number(candidate.elapsedHere))
      : null,
    activeElapsed: null,
    startedIGT: candidate.validFromIGT,
    endedIGT: candidate.validThroughIGT,
    lastActiveIGT: candidate.validThroughIGT,
    sourceType: 'resident-presence',
    sourceId: null,
    paused: candidate.paused === true,
  });
}

function eligibleCandidatePool(candidates, {
  viewerId,
  primaryFamiliarIds,
  expectedTimeBasis,
  nowMs,
} = {}) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const expiresAt = timestamp(candidate?.expiresAt);
    if (!candidate?.profileId || seen.has(candidate.profileId)
        || candidate.profileId === viewerId
        || primaryFamiliarIds.has(candidate.profileId)
        || candidate.timeBasis !== expectedTimeBasis
        || expiresAt == null || expiresAt <= nowMs) return false;
    seen.add(candidate.profileId);
    return true;
  });
}

function snapshotId({ viewerId, viewingSessionId, mode, nowMs, slots }) {
  const occupants = slots.map((slot) => `${slot.slotId}:${slot.occupant.profileId}`).join('|');
  return `occupancy:${fnv1a32(`${viewerId}|${viewingSessionId}|${mode}|${nowMs}|${occupants}`)
    .toString(16).padStart(8, '0')}`;
}

/**
 * Pure occupancy resolution. Familiar-circle selection and evidence retrieval
 * stay outside this module; it only decides who may occupy prepared slots.
 */
export function resolveResidentOccupancy({
  viewerId,
  viewerIGT = 0,
  viewingSessionId,
  primarySlots = [],
  familiarFacts = {},
  eligibleCandidates = [],
  currentLeases = [],
  recentResidentProfileIds = [],
  mode = RESIDENT_MODE.off,
  nowMs = Date.now(),
  selectionSeed = 'resident-session',
  allowGenericActive = false,
} = {}) {
  if (!viewerId || !viewingSessionId) {
    throw new TypeError('Resident occupancy resolution requires viewer and viewing session IDs.');
  }
  if (!isResidentMode(mode)) throw new TypeError(`Unsupported resident mode: ${mode}`);
  if (!Number.isFinite(Number(nowMs))) throw new TypeError('Resident occupancy resolution requires a finite time.');

  const resolvedAt = iso(nowMs);
  const primary = buildPrimaryOnlyOccupancySnapshot({
    viewerId,
    viewerIGT,
    mode,
    primarySlots,
    presences: Object.fromEntries(primarySlots.map((slot) => [
      slot.primaryFamiliarId,
      familiarFacts[slot.primaryFamiliarId]?.presence || null,
    ])),
    viewingSessionId,
    resolvedAt,
  });
  if (mode === RESIDENT_MODE.off || !primarySlots.length) {
    return Object.freeze({
      snapshot: primary,
      leases: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }

  const expectedTimeBasis = mode === RESIDENT_MODE.fullLive
    ? RESIDENT_TIME_BASIS.liveWallClock
    : RESIDENT_TIME_BASIS.viewerIGT;
  const primaryFamiliarIds = new Set(primarySlots.map((slot) => slot.primaryFamiliarId));
  const candidates = eligibleCandidatePool(eligibleCandidates, {
    viewerId: String(viewerId), primaryFamiliarIds, expectedTimeBasis, nowMs,
  });
  const candidatesById = new Map(candidates.map((candidate) => [candidate.profileId, candidate]));
  const leasesBySlot = new Map(currentLeases
    .filter((lease) => lease?.timeBasis === expectedTimeBasis && timestamp(lease.expiresAt) > nowMs)
    .map((lease) => [lease.slotId, lease]));
  const repeated = new Set(recentResidentProfileIds.map(String));
  const selected = new Set();
  const diagnostics = [];
  const leases = [];
  const slots = [];

  for (const primarySlot of primarySlots) {
    const primarySlotSnapshot = primary.slots.find((slot) => slot.slotId === primarySlot.slotId);
    const fact = familiarFacts[primarySlot.primaryFamiliarId] || null;
    const evidenceResolved = fact?.evidenceResolved === true;
    const familiarRepresentable = isPrimaryFamiliarRepresentable({
      mode,
      livePresence: fact?.presence || null,
      alignedPresence: fact?.presence || null,
      liveEvidenceResolved: evidenceResolved,
      alignedEvidenceResolved: evidenceResolved,
      nowMs,
    });
    const incumbentLease = leasesBySlot.get(primarySlot.slotId) || null;
    const incumbent = incumbentLease ? candidatesById.get(incumbentLease.residentProfileId) : null;

    if (!evidenceResolved) {
      diagnostics.push(Object.freeze({
        code: RESIDENT_OCCUPANCY_DIAGNOSTIC.evidenceUnresolved,
        slotId: primarySlot.slotId,
      }));
      slots.push(primarySlotSnapshot);
      continue;
    }
    if (familiarRepresentable && (!incumbent || fact?.reclaimConfirmed === true)) {
      diagnostics.push(Object.freeze({
        code: incumbent && fact?.reclaimConfirmed
          ? RESIDENT_OCCUPANCY_DIAGNOSTIC.familiarReclaimed
          : RESIDENT_OCCUPANCY_DIAGNOSTIC.familiarRepresentable,
        slotId: primarySlot.slotId,
      }));
      slots.push(primarySlotSnapshot);
      continue;
    }

    const available = candidates.filter((candidate) => !selected.has(candidate.profileId));
    if (!available.length) {
      const lastVerifiedAt = timestamp(incumbentLease?.verifiedAt);
      if (incumbentLease && lastVerifiedAt != null
          && nowMs - lastVerifiedAt <= RESIDENT_SUBSTITUTION_LIMITS.residentDisconnectGraceMs) {
        // Keep only the assignment hint. The snapshot still restores the
        // familiar immediately, so expired evidence is never rendered.
        leases.push(Object.freeze({ ...incumbentLease }));
        diagnostics.push(Object.freeze({
          code: RESIDENT_OCCUPANCY_DIAGNOSTIC.incumbentGraceRetained,
          slotId: primarySlot.slotId,
          residentProfileId: incumbentLease.residentProfileId,
        }));
        slots.push(primarySlotSnapshot);
        continue;
      }
      diagnostics.push(Object.freeze({
        code: RESIDENT_OCCUPANCY_DIAGNOSTIC.noEligibleCandidate,
        slotId: primarySlot.slotId,
      }));
      slots.push(primarySlotSnapshot);
      continue;
    }
    const incumbentProfileId = incumbent?.profileId || null;
    const chosen = [...available].sort((left, right) => compareTuple(
      candidateTuple(left, {
        viewerId, selectionSeed, incumbentProfileId,
        recentResidentProfileIds: repeated, nowMs,
      }),
      candidateTuple(right, {
        viewerId, selectionSeed, incumbentProfileId,
        recentResidentProfileIds: repeated, nowMs,
      }),
    ) || left.profileId.localeCompare(right.profileId))[0];
    selected.add(chosen.profileId);
    const card = buildResidentPresenceCard({
      identity: chosen.identity,
      activityCategory: chosen.activity.category,
      timeBasis: chosen.timeBasis,
      allowGenericActive,
    });
    const occupant = buildResidentOccupant(card, residentPresence(chosen));
    slots.push(Object.freeze({
      slotId: primarySlot.slotId,
      relationshipRole: primarySlot.relationshipRole,
      primaryFamiliarId: primarySlot.primaryFamiliarId,
      occupant,
    }));
    const retained = incumbentProfileId === chosen.profileId;
    const leasedAt = retained ? incumbentLease.leasedAt : resolvedAt;
    const hardLeaseExpiry = timestamp(leasedAt) + RESIDENT_SUBSTITUTION_LIMITS.presentationLeaseMs;
    leases.push(Object.freeze({
      viewerId: String(viewerId),
      viewingSessionId: String(viewingSessionId),
      slotId: primarySlot.slotId,
      primaryFamiliarId: primarySlot.primaryFamiliarId,
      residentProfileId: chosen.profileId,
      timeBasis: chosen.timeBasis,
      activityCategory: chosen.activity.category,
      evidenceId: chosen.evidenceId,
      eligibilityVersion: chosen.eligibilityVersion,
      leasedAt,
      verifiedAt: resolvedAt,
      expiresAt: iso(hardLeaseExpiry),
    }));
    diagnostics.push(Object.freeze({
      code: familiarRepresentable
        ? RESIDENT_OCCUPANCY_DIAGNOSTIC.familiarReclaimPending
        : retained
          ? RESIDENT_OCCUPANCY_DIAGNOSTIC.incumbentRetained
          : RESIDENT_OCCUPANCY_DIAGNOSTIC.residentAssigned,
      slotId: primarySlot.slotId,
      residentProfileId: chosen.profileId,
    }));
  }

  const residentEvidenceExpiries = slots
    .filter((slot) => slot.occupant.kind === 'resident')
    .map((slot) => timestamp(candidatesById.get(slot.occupant.profileId)?.expiresAt))
    .filter(Number.isFinite);
  const snapshot = Object.freeze({
    ...primary,
    snapshotId: snapshotId({ viewerId, viewingSessionId, mode, nowMs, slots }),
    refreshAfter: iso(nowMs + RESIDENT_SUBSTITUTION_LIMITS.occupancyRefreshMs),
    expiresAt: residentEvidenceExpiries.length ? iso(Math.min(...residentEvidenceExpiries)) : null,
    slots: Object.freeze(slots),
  });
  assertResidentOccupancySnapshot(snapshot);
  return Object.freeze({
    snapshot,
    leases: Object.freeze(leases),
    diagnostics: Object.freeze(diagnostics),
  });
}

export default resolveResidentOccupancy;
