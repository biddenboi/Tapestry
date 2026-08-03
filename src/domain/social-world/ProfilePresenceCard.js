import { DAY } from '../constants.js';
import { buildProfileIdentity } from '../profile/ProfileIdentity.js';
import { getRankLabel } from '../rank/Rank.js';
import { formatWorldIGT } from '../time/Time.js';
import {
  PRESENCE_STATE,
  VISIBILITY_TIER,
} from './SocialWorldContracts.js';
import { emptyProfileContextProjection } from '../profile-context/Contracts.js';

export const PROFILE_PRESENCE_CARD_VERSION = 4;

function nonNegative(value) {
  return Math.max(0, Number(value) || 0);
}

function identityModel(identity = {}) {
  const profileId = String(identity.profileId || identity.UUID || identity.id || '');
  if (!profileId) return null;
  return buildProfileIdentity({ ...identity, profileId });
}

function nowModel(presence = {}, activityLabel = null) {
  const state = Object.values(PRESENCE_STATE).includes(presence.state)
    ? presence.state
    : PRESENCE_STATE.inactive;
  return Object.freeze({
    intervalId: presence.intervalId || null,
    state,
    location: presence.location || null,
    claim: presence.claim || 'none',
    elapsedHere: presence.elapsedHere == null ? null : nonNegative(presence.elapsedHere),
    activeElapsed: presence.activeElapsed == null ? null : nonNegative(presence.activeElapsed),
    startedIGT: presence.startedIGT == null ? null : nonNegative(presence.startedIGT),
    endedIGT: presence.endedIGT == null ? null : nonNegative(presence.endedIGT),
    paused: Boolean(presence.paused),
    activityLabel: activityLabel || presence.presentation?.primary || 'No current activity',
    presentation: presence.presentation || null,
  });
}

function todayModel(today, viewerIGT) {
  const dayIndex = Math.floor(nonNegative(viewerIGT) / DAY);
  return Object.freeze({
    dayIndex,
    tasks: Math.max(0, Math.trunc(Number(today?.tasks) || 0)),
    points: Math.floor(nonNegative(today?.points)),
    activeMs: nonNegative(today?.activeMs),
  });
}

function threadModel(thread) {
  const evidenceCount = Math.max(0, Math.trunc(Number(thread?.evidenceCount) || 0));
  if (!thread?.projectId || !thread?.label || evidenceCount < 1) return null;
  return Object.freeze({
    projectId: String(thread.projectId),
    label: String(thread.label),
    state: String(thread.state || 'continuing'),
    evidenceCount,
    encounterCount: Math.max(0, Math.trunc(Number(thread.encounterCount) || 0)),
    latestIGT: thread.latestIGT == null ? null : nonNegative(thread.latestIGT),
  });
}

function pastModel(entries = []) {
  return Object.freeze((entries || []).filter((entry) => (
    entry?.id && entry?.label && Number.isFinite(Number(entry.completedIGT))
  )).slice(0, 4).map((entry) => Object.freeze({
    type: String(entry.type || 'task'),
    id: String(entry.id),
    label: String(entry.label),
    completedIGT: nonNegative(entry.completedIGT),
    basePoints: Math.floor(nonNegative(entry.basePoints)),
    activeMs: nonNegative(entry.activeMs),
    projectId: entry.projectId ? String(entry.projectId) : null,
    projectLabel: entry.projectLabel ? String(entry.projectLabel) : null,
  })));
}

function changeFactModel(fact) {
  if (!fact?.kind || !fact?.id || !fact?.versionToken) return null;
  const oldElo = Number(fact.oldElo);
  const newElo = Number(fact.newElo);
  const rankDetail = fact.kind === 'rank' && Number.isFinite(oldElo) && Number.isFinite(newElo)
    ? `${getRankLabel(oldElo)} → ${getRankLabel(newElo)} · ${Math.round(oldElo)} → ${Math.round(newElo)} ELO`
    : null;
  return Object.freeze({
    kind: String(fact.kind),
    id: String(fact.id),
    category: String(fact.category || 'Changes'),
    label: String(fact.label || 'Recorded activity'),
    detail: rankDetail,
    oldElo: rankDetail ? oldElo : null,
    newElo: rankDetail ? newElo : null,
    delta: rankDetail ? Number(fact.delta || (newElo - oldElo)) : null,
    matchId: rankDetail ? fact.matchId || null : null,
    occurredIGT: nonNegative(fact.occurredIGT),
    versionToken: String(fact.versionToken),
    changeState: fact.changeState === 'updated' ? 'updated' : 'new',
  });
}

function noveltyModel(memory) {
  const facts = Object.freeze((memory?.facts || []).map(changeFactModel).filter(Boolean).slice(0, 24));
  const byKey = new Map(facts.map((fact) => [`${fact.kind}:${fact.id}`, fact]));
  const preview = Object.freeze((memory?.preview || [])
    .map((fact) => byKey.get(`${fact.kind}:${fact.id}`) || changeFactModel(fact))
    .filter(Boolean)
    .slice(0, 3));
  const groups = Object.freeze((memory?.groups || []).map((group) => Object.freeze({
    category: String(group.category || 'Changes'),
    facts: Object.freeze((group.facts || [])
      .map((fact) => byKey.get(`${fact.kind}:${fact.id}`) || changeFactModel(fact))
      .filter(Boolean)),
  })).filter((group) => group.facts.length));
  return Object.freeze({
    count: Math.max(facts.length, Math.max(0, Math.trunc(Number(memory?.count) || 0))),
    preview,
    facts,
    groups,
    previousEncounter: memory?.previousEncounter ? Object.freeze({
      surface: String(memory.previousEncounter.surface || 'profile-drawer'),
      viewerIGT: nonNegative(memory.previousEncounter.viewerIGT),
    }) : null,
  });
}

function nextModel(entries = []) {
  return Object.freeze((entries || [])
    .filter((entry) => entry?.explicitCommitment === true && entry?.id && entry?.label)
    .slice(0, 4)
    .map((entry) => Object.freeze({
      type: String(entry.type || 'todo'),
      id: String(entry.id),
      label: String(entry.label),
      dueAt: entry.dueAt ? String(entry.dueAt) : null,
      projectId: entry.projectId ? String(entry.projectId) : null,
      projectLabel: entry.projectLabel ? String(entry.projectLabel) : null,
    })));
}

function lastActiveModel(presence, access, viewerIGT) {
  if ([PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(presence?.state)) {
    return Object.freeze({
      inGameTimestamp: access?.canViewRichLastActive ? nonNegative(viewerIGT) : null,
      label: presence.state === PRESENCE_STATE.current ? 'Active now' : 'Active at your IGT',
    });
  }
  const boundary = Number(presence?.lastActiveIGT);
  if (!Number.isFinite(boundary) || boundary < 0) {
    return Object.freeze({ inGameTimestamp: null, label: 'No recorded activity' });
  }
  if (!access?.canViewRichLastActive) {
    return Object.freeze({ inGameTimestamp: null, label: 'Recently active' });
  }
  return Object.freeze({
    inGameTimestamp: boundary,
    label: `Last active ${formatWorldIGT(boundary)}`,
  });
}

/**
 * Creates the compact, visibility-filtered card shared by every social-world
 * inspection surface. Outside-cast subjects fail closed instead of receiving
 * a partially privileged model.
 */
export function buildProfilePresenceCard({
  identity,
  role,
  access,
  presence,
  activityLabel,
  today,
  past,
  thread,
  next,
  changeMemory,
  context,
  viewerIGT,
} = {}) {
  if (!access || access.tier === VISIBILITY_TIER.outside) return null;
  const normalizedIdentity = identityModel(identity);
  if (!normalizedIdentity) return null;
  const normalizedPresence = presence || { state: PRESENCE_STATE.inactive };
  return Object.freeze({
    schemaVersion: PROFILE_PRESENCE_CARD_VERSION,
    asOfIGT: nonNegative(viewerIGT),
    identity: normalizedIdentity,
    role: role || access.tier,
    visibilityTier: access.tier,
    now: nowModel(normalizedPresence, activityLabel),
    today: todayModel(today, viewerIGT),
    past: pastModel(past),
    thread: threadModel(thread),
    next: nextModel(next),
    new: noveltyModel(changeMemory),
    context: context || emptyProfileContextProjection({
      viewerId: access.viewerId,
      subjectId: access.profileId,
      viewerTier: access.tier,
      asOfIGT: viewerIGT,
    }),
    lastActive: lastActiveModel(normalizedPresence, access, viewerIGT),
    actions: Object.freeze({
      canOpenProfile: access.allowedTabs?.includes('overview') === true,
      canOpenDaybook: access.daybookScope !== 'none',
      daybookScope: access.daybookScope,
      canOpenSettings: access.settingsScope === 'full',
    }),
  });
}

export default buildProfilePresenceCard;
