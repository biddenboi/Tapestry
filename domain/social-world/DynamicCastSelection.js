import { getRankBandOrdinal, getRankLabel } from '../rank/Rank.js';
import { CAST_ROLE } from './SocialWorldContracts.js';

export const DYNAMIC_CAST_ALGORITHM_VERSION = 1;
export const DYNAMIC_CAST_RESIDENCE_IGT_DAYS = 7;
export const DYNAMIC_CAST_RESIDENCE_IGT_MS = DYNAMIC_CAST_RESIDENCE_IGT_DAYS * 24 * 60 * 60 * 1000;
export const MAX_HORIZON_BAND_GAP = 3;
export const MIN_INTERPRETABLE_HISTORY_FACTS = 2;
export const MIN_HORIZON_HISTORY_FACTS = 3;

const ROLES = Object.freeze([CAST_ROLE.nearPeer, CAST_ROLE.horizon]);

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().toLocaleLowerCase())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeProfile(profile = {}) {
  const id = String(profile.id || profile.UUID || profile.playerId || '');
  const elo = Math.max(0, Number(profile.elo) || 0);
  const completedTaskCount = Math.max(0, Math.trunc(Number(profile.completedTaskCount) || 0));
  const completedMatchCount = Math.max(0, Math.trunc(Number(profile.completedMatchCount) || 0));
  const explicitGoals = uniqueStrings(profile.explicitGoals);
  const actionKinds = uniqueStrings(profile.actionKinds);
  const historyFactCount = completedTaskCount + completedMatchCount;
  return Object.freeze({
    id,
    elo,
    bandOrdinal: getRankBandOrdinal(elo),
    bandLabel: getRankLabel(elo),
    completedTaskCount,
    completedMatchCount,
    historyFactCount,
    explicitGoals,
    actionKinds,
    archived: Boolean(profile.archived || profile.archivedAt),
    banned: Boolean(profile.banned || profile.bannedAt),
    bootstrap: Boolean(profile.bootstrap || profile.legacyBootstrap),
  });
}

function intersection(left, right) {
  const other = new Set(right);
  return left.filter((value) => other.has(value));
}

function baseExclusion(candidate, viewer, friendIds) {
  if (!candidate.id || candidate.id === viewer.id) return 'self-or-missing';
  if (candidate.archived || candidate.banned || candidate.bootstrap) return 'unavailable-profile';
  if (friendIds.has(candidate.id)) return 'friend';
  if (candidate.historyFactCount < MIN_INTERPRETABLE_HISTORY_FACTS) return 'insufficient-history';
  return null;
}

function nearPeerBucket(candidate, viewer) {
  const delta = candidate.bandOrdinal - viewer.bandOrdinal;
  if (Math.abs(delta) > 1) return null;
  if (delta === 0 && candidate.elo >= viewer.elo) return 0;
  if (delta === 1) return 1;
  if (delta === 0) return 2;
  return 3;
}

function horizonEligible(candidate, viewer) {
  const delta = candidate.bandOrdinal - viewer.bandOrdinal;
  const hasTrajectoryAnchor = candidate.explicitGoals.length > 0 || candidate.actionKinds.length >= 2;
  return delta >= 1
    && delta <= MAX_HORIZON_BAND_GAP
    && candidate.historyFactCount >= MIN_HORIZON_HISTORY_FACTS
    && hasTrajectoryAnchor;
}

function stableIdentityCompare(left, right) {
  return left.id.localeCompare(right.id);
}

function compareNearPeers(viewer) {
  return (left, right) => {
    const bucketDelta = nearPeerBucket(left, viewer) - nearPeerBucket(right, viewer);
    if (bucketDelta) return bucketDelta;
    const leftOverlap = intersection(left.explicitGoals, viewer.explicitGoals).length
      + intersection(left.actionKinds, viewer.actionKinds).length;
    const rightOverlap = intersection(right.explicitGoals, viewer.explicitGoals).length
      + intersection(right.actionKinds, viewer.actionKinds).length;
    if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
    const gapDelta = Math.abs(left.elo - viewer.elo) - Math.abs(right.elo - viewer.elo);
    return gapDelta || stableIdentityCompare(left, right);
  };
}

function compareHorizons(viewer, nearPeer) {
  return (left, right) => {
    const bandDelta = (left.bandOrdinal - viewer.bandOrdinal) - (right.bandOrdinal - viewer.bandOrdinal);
    if (bandDelta) return bandDelta;
    const leftNearOverlap = nearPeer ? intersection(left.actionKinds, nearPeer.actionKinds).length : 0;
    const rightNearOverlap = nearPeer ? intersection(right.actionKinds, nearPeer.actionKinds).length : 0;
    if (leftNearOverlap !== rightNearOverlap) return leftNearOverlap - rightNearOverlap;
    const leftRelevance = intersection(left.explicitGoals, viewer.explicitGoals).length
      + intersection(left.actionKinds, viewer.actionKinds).length;
    const rightRelevance = intersection(right.explicitGoals, viewer.explicitGoals).length
      + intersection(right.actionKinds, viewer.actionKinds).length;
    if (leftRelevance !== rightRelevance) return rightRelevance - leftRelevance;
    return stableIdentityCompare(left, right);
  };
}

function roleEligible(role, candidate, viewer) {
  if (role === CAST_ROLE.nearPeer) return nearPeerBucket(candidate, viewer) != null;
  if (role === CAST_ROLE.horizon) return horizonEligible(candidate, viewer);
  return false;
}

function assignmentEvidence({ role, candidate, viewer, nearPeer, retained }) {
  const bandDelta = candidate.bandOrdinal - viewer.bandOrdinal;
  const goalOverlap = intersection(candidate.explicitGoals, viewer.explicitGoals);
  const actionOverlap = intersection(candidate.actionKinds, viewer.actionKinds);
  const nearActionOverlap = nearPeer && nearPeer.id !== candidate.id
    ? intersection(candidate.actionKinds, nearPeer.actionKinds)
    : [];
  const reasonCodes = ['interpretable-history'];
  if (role === CAST_ROLE.nearPeer) {
    if (bandDelta === 0) reasonCodes.push('same-band');
    else reasonCodes.push(bandDelta > 0 ? 'adjacent-band-ahead' : 'adjacent-band-behind');
    if (candidate.elo >= viewer.elo) reasonCodes.push('lateral-or-modestly-ahead');
    if (goalOverlap.length || actionOverlap.length) reasonCodes.push('explicit-domain-overlap');
  } else {
    reasonCodes.push('nearest-attainable-higher-band');
    if (nearPeer && nearActionOverlap.length < candidate.actionKinds.length) reasonCodes.push('action-mix-broadens-cast');
    if (goalOverlap.length || actionOverlap.length) reasonCodes.push('viewer-relevant');
    reasonCodes.push('trajectory-anchor-present');
  }
  if (retained) reasonCodes.unshift('valid-incumbent-retained');
  return Object.freeze({
    policy: 'ordered-role-constraints-no-composite-score',
    decision: retained ? 'incumbent-retained' : 'selected',
    reasonCodes: Object.freeze(reasonCodes),
    band: Object.freeze({
      viewer: viewer.bandLabel,
      subject: candidate.bandLabel,
      delta: bandDelta,
    }),
    overlap: Object.freeze({
      explicitGoals: Object.freeze(goalOverlap),
      actionKinds: Object.freeze(actionOverlap),
      nearPeerActionKinds: Object.freeze(nearActionOverlap),
    }),
    history: Object.freeze({
      completedTaskCount: candidate.completedTaskCount,
      completedMatchCount: candidate.completedMatchCount,
      explicitGoalCount: candidate.explicitGoals.length,
      actionKindCount: candidate.actionKinds.length,
      interpretable: true,
    }),
  });
}

function normalizeIncumbents(incumbents = []) {
  const byRole = new Map();
  for (const assignment of Array.isArray(incumbents) ? incumbents : []) {
    if (!ROLES.includes(assignment?.role) || byRole.has(assignment.role)) continue;
    byRole.set(assignment.role, assignment);
  }
  return byRole;
}

export function inspectDynamicCastIncumbents({ viewer, candidates = [], friendIds = [], incumbents = [] } = {}) {
  const normalizedViewer = normalizeProfile(viewer);
  const friends = new Set((Array.isArray(friendIds) ? friendIds : []).map(String));
  const profiles = new Map(candidates.map(normalizeProfile).filter((candidate) => candidate.id).map((candidate) => [candidate.id, candidate]));
  const byRole = normalizeIncumbents(incumbents);
  const valid = new Map();
  const invalid = [];
  const used = new Set();
  for (const role of ROLES) {
    const assignment = byRole.get(role);
    if (!assignment) continue;
    const candidate = profiles.get(String(assignment.subjectId || assignment.subject_player_id || ''));
    const reason = !candidate
      ? 'missing-profile'
      : baseExclusion(candidate, normalizedViewer, friends)
        || (!roleEligible(role, candidate, normalizedViewer) ? 'role-invalid' : null)
        || (Number(assignment.algorithmVersion) !== DYNAMIC_CAST_ALGORITHM_VERSION ? 'algorithm-version' : null)
        || (used.has(candidate.id) ? 'duplicate-subject' : null);
    if (reason) invalid.push(Object.freeze({ role, subjectId: candidate?.id || assignment.subjectId || null, reason }));
    else {
      valid.set(role, Object.freeze({ assignment, candidate }));
      used.add(candidate.id);
    }
  }
  return Object.freeze({ viewer: normalizedViewer, candidates: profiles, friends, valid, invalid: Object.freeze(invalid) });
}

export function buildDynamicCastReview({
  viewer,
  candidates = [],
  friendIds = [],
  incumbents = [],
  viewerIGT = 0,
  reviewReason = 'scheduled',
} = {}) {
  const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
  const inspected = inspectDynamicCastIncumbents({ viewer, candidates, friendIds, incumbents });
  const { viewer: normalizedViewer, friends, valid } = inspected;
  const normalizedCandidates = [...inspected.candidates.values()];
  const exclusionCounts = {};
  const baseEligible = normalizedCandidates.filter((candidate) => {
    const reason = baseExclusion(candidate, normalizedViewer, friends);
    if (reason) exclusionCounts[reason] = (exclusionCounts[reason] || 0) + 1;
    return !reason;
  });

  let nearPeer = valid.get(CAST_ROLE.nearPeer)?.candidate || null;
  let horizon = valid.get(CAST_ROLE.horizon)?.candidate || null;
  if (!nearPeer) {
    nearPeer = baseEligible
      .filter((candidate) => candidate.id !== horizon?.id && roleEligible(CAST_ROLE.nearPeer, candidate, normalizedViewer))
      .sort(compareNearPeers(normalizedViewer))[0] || null;
  }
  if (!horizon) {
    horizon = baseEligible
      .filter((candidate) => candidate.id !== nearPeer?.id && roleEligible(CAST_ROLE.horizon, candidate, normalizedViewer))
      .sort(compareHorizons(normalizedViewer, nearPeer))[0] || null;
  }

  const reviewAfterIGT = cursor + DYNAMIC_CAST_RESIDENCE_IGT_MS;
  const selected = new Map([
    [CAST_ROLE.nearPeer, nearPeer],
    [CAST_ROLE.horizon, horizon],
  ]);
  const assignments = ROLES.flatMap((role) => {
    const candidate = selected.get(role);
    if (!candidate) return [];
    const incumbent = valid.get(role);
    const retained = incumbent?.candidate.id === candidate.id;
    return [Object.freeze({
      role,
      subjectId: candidate.id,
      algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION,
      assignedAtIGT: retained ? Number(incumbent.assignment.assignedAtIGT) : cursor,
      reviewAfterIGT,
      evidence: assignmentEvidence({ role, candidate, viewer: normalizedViewer, nearPeer, retained }),
    })];
  });
  const assignedRoles = Object.freeze(Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.subjectId])));
  const vacantRoles = Object.freeze(ROLES.filter((role) => !assignedRoles[role]));
  return Object.freeze({
    assignments: Object.freeze(assignments),
    review: Object.freeze({
      algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION,
      reviewedAtIGT: cursor,
      reviewAfterIGT,
      outcome: String(reviewReason || 'scheduled'),
      diagnostics: Object.freeze({
        policy: 'ordered-role-constraints-no-composite-score',
        residenceDays: DYNAMIC_CAST_RESIDENCE_IGT_DAYS,
        candidateCount: normalizedCandidates.length,
        baseEligibleCount: baseEligible.length,
        assignedRoles,
        vacantRoles,
        excluded: Object.freeze({ ...exclusionCounts }),
        invalidatedIncumbents: inspected.invalid,
      }),
    }),
  });
}

export function isDynamicCastReviewDue(review, viewerIGT) {
  if (!review || Number(review.algorithmVersion) !== DYNAMIC_CAST_ALGORITHM_VERSION) return true;
  return Math.max(0, Math.trunc(Number(viewerIGT) || 0)) >= Number(review.reviewAfterIGT || 0);
}

export default buildDynamicCastReview;
