import { formatWorldIGT } from '../time/Time.js';
import { buildProfileIdentity } from '../profile/ProfileIdentity.js';
import { buildPresencePresentation } from './PresencePresentation.js';
import {
  CAST_ROLE,
  CAST_CAPACITY,
  PRESENCE_CLAIM,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
  SOCIAL_WORLD_CONTRACT_VERSION,
  VISIBILITY_TIER,
  isSemanticLocation,
} from './SocialWorldContracts.js';

export const SOCIAL_WORLD_LOCATION_ORDER = Object.freeze([
  SEMANTIC_LOCATION.planning,
  SEMANTIC_LOCATION.taskSession,
  SEMANTIC_LOCATION.dojo,
  SEMANTIC_LOCATION.matchArena,
  SEMANTIC_LOCATION.marketplace,
  SEMANTIC_LOCATION.commons,
]);

const INACTIVE_PRESENCE = Object.freeze({
  state: PRESENCE_STATE.inactive,
  location: null,
  claim: PRESENCE_CLAIM.none,
  elapsedHere: null,
  activeElapsed: null,
  startedIGT: null,
  endedIGT: null,
  lastActiveIGT: null,
  paused: false,
  presentation: Object.freeze({
    state: PRESENCE_STATE.inactive,
    locationLabel: null,
    statusLabel: 'Inactive',
    elapsedHereLabel: null,
    activeElapsedLabel: null,
    primary: 'No recent activity',
    secondary: null,
  }),
});

function asId(value) {
  return value == null ? '' : String(value);
}

function memberFromFamiliar(familiar, fallbackRole) {
  const profileId = asId(familiar?.subjectId || familiar?.UUID || familiar?.id || familiar?.profile?.UUID || familiar?.profile?.id);
  return profileId ? {
    profileId,
    profile: familiar?.profile || familiar,
    role: familiar?.role || fallbackRole,
    visibilityTier: familiar?.visibilityTier || familiar?.profile?.visibilityTier || (
      fallbackRole === CAST_ROLE.friend ? VISIBILITY_TIER.friend : VISIBILITY_TIER.dynamic
    ),
  } : null;
}

function normalizePresence(value) {
  if (!value || !Object.values(PRESENCE_STATE).includes(value.state)) return INACTIVE_PRESENCE;
  if (value.state !== PRESENCE_STATE.inactive && !isSemanticLocation(value.location)) return INACTIVE_PRESENCE;
  return Object.freeze({ ...value });
}

function roleOrder(role) {
  if (role === CAST_ROLE.self) return 0;
  if (role === CAST_ROLE.friend) return 1;
  if (role === CAST_ROLE.nearPeer) return 2;
  if (role === CAST_ROLE.horizon) return 3;
  return 4;
}

export function partitionSceneMembers(members = []) {
  const active = [];
  const inactive = [];
  for (const member of members) {
    if ([PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(member?.presence?.state)) {
      active.push(member);
    } else {
      inactive.push(member);
    }
  }
  return Object.freeze({
    active: Object.freeze(active),
    inactive: Object.freeze(inactive),
  });
}

/**
 * Replaces only the active viewer's current-scene presence with the location
 * already known by the running application. Persisted intervals remain the
 * source of truth for history and every other profile, but they cannot make
 * the live viewer appear in a historical location (or in the Away rail).
 */
export function withLiveViewerPresence(scene, {
  profileId = scene?.viewer?.profileId,
  location,
  viewerIGT = scene?.viewer?.inGameTime,
  sourceType = null,
  sourceId = null,
} = {}) {
  const id = asId(profileId);
  if (!scene || !id || id !== asId(scene.viewer?.profileId) || !isSemanticLocation(location)) {
    return scene;
  }

  const existingMember = scene.memberById?.get(id)
    || scene.members?.find((member) => asId(member?.profileId) === id);
  if (!existingMember) return scene;

  const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
  const existingPresence = existingMember.presence || INACTIVE_PRESENCE;
  const continuesExactInterval = existingPresence.state === PRESENCE_STATE.current
    && existingPresence.location === location
    && existingPresence.endedIGT == null
    && Number.isFinite(Number(existingPresence.startedIGT))
    && Number(existingPresence.startedIGT) <= cursor;
  const startedIGT = continuesExactInterval
    ? Number(existingPresence.startedIGT)
    : cursor;
  const elapsedHere = Math.max(0, cursor - startedIGT);
  const activeElapsed = continuesExactInterval && existingPresence.activeElapsed != null
    ? Math.min(elapsedHere, Math.max(0, Number(existingPresence.activeElapsed) || 0))
    : null;
  const livePresenceBase = {
    intervalId: continuesExactInterval ? existingPresence.intervalId || null : null,
    state: PRESENCE_STATE.current,
    location,
    claim: PRESENCE_CLAIM.exactCurrent,
    elapsedHere,
    activeElapsed,
    startedIGT,
    endedIGT: null,
    lastActiveIGT: cursor,
    sourceType: sourceType || (continuesExactInterval ? existingPresence.sourceType : null) || 'live-app-state',
    sourceId: sourceId || (continuesExactInterval ? existingPresence.sourceId : null) || null,
    paused: continuesExactInterval ? Boolean(existingPresence.paused) : false,
  };
  const livePresence = Object.freeze({
    ...livePresenceBase,
    presentation: buildPresencePresentation(livePresenceBase, cursor),
  });
  const liveMember = Object.freeze({
    ...existingMember,
    presence: livePresence,
  });
  const members = Object.freeze(scene.members.map((member) => (
    asId(member.profileId) === id ? liveMember : member
  )));
  const memberById = new Map(members.map((member) => [member.profileId, member]));
  const partition = partitionSceneMembers(members);
  const locations = Object.freeze(SOCIAL_WORLD_LOCATION_ORDER.map((locationId) => Object.freeze({
    id: locationId,
    occupants: Object.freeze(partition.active
      .filter((member) => member.presence.location === locationId)
      .map((member) => member.profileId)),
  })));
  const inactiveMembers = Object.freeze(
    partition.inactive.map((member) => member.profileId),
  );

  return Object.freeze({
    ...scene,
    viewer: Object.freeze({
      ...scene.viewer,
      inGameTime: cursor,
      clockLabel: formatWorldIGT(cursor),
    }),
    members,
    memberById,
    locations,
    inactiveMembers,
  });
}

/**
 * Builds the small, visibility-filtered scene consumed by React. It never
 * selects candidates, reads stores, or infers activity from identity data.
 */
export function buildSocialWorldScene({
  viewerId,
  viewerIGT,
  viewerProfile,
  residency,
  presences = {},
  sourceVersions = {},
} = {}) {
  const id = asId(viewerId);
  const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
  if (!id) throw new TypeError('A social-world scene requires a viewer profile.');

  const surroundingCandidates = [
    ...(residency?.friends || []).map((entry) => memberFromFamiliar(entry, CAST_ROLE.friend)),
    ...(residency?.dynamic || []).map((entry) => memberFromFamiliar(entry, entry?.role)),
  ];
  const candidates = [
    {
      profileId: id,
      profile: viewerProfile || { UUID: id },
      role: CAST_ROLE.self,
      visibilityTier: VISIBILITY_TIER.self,
    },
    ...surroundingCandidates,
  ].filter(Boolean);

  const seen = new Set();
  const members = candidates
    .filter((candidate) => {
      if (!candidate.profileId || seen.has(candidate.profileId)) return false;
      seen.add(candidate.profileId);
      return true;
    })
    .map((candidate) => Object.freeze({
      profileId: candidate.profileId,
      identity: buildProfileIdentity({ ...candidate.profile, profileId: candidate.profileId }),
      role: candidate.role,
      visibilityTier: candidate.visibilityTier,
      presence: normalizePresence(presences[candidate.profileId] || candidate.presence),
      today: null,
      thread: null,
      next: null,
      newCount: 0,
    }))
    .sort((left, right) => (
      roleOrder(left.role) - roleOrder(right.role)
      || left.identity.username.localeCompare(right.identity.username)
      || left.profileId.localeCompare(right.profileId)
    ));

  const memberById = new Map(members.map((member) => [member.profileId, member]));
  const partition = partitionSceneMembers(members);
  const locations = SOCIAL_WORLD_LOCATION_ORDER.map((locationId) => Object.freeze({
    id: locationId,
    occupants: Object.freeze(partition.active
      .filter((member) => member.presence.location === locationId)
      .map((member) => member.profileId)),
  }));
  const inactiveMembers = partition.inactive
    .map((member) => member.profileId);

  return Object.freeze({
    schemaVersion: SOCIAL_WORLD_CONTRACT_VERSION,
    viewer: Object.freeze({
      profileId: id,
      inGameTime: cursor,
      clockLabel: formatWorldIGT(cursor),
    }),
    members: Object.freeze(members),
    memberById,
    locations: Object.freeze(locations),
    inactiveMembers: Object.freeze(inactiveMembers),
    emptyFriendSlots: Math.max(0, Number(residency?.emptyFriendSlots) || 0),
    sourceVersions: Object.freeze({ ...sourceVersions }),
  });
}

export default buildSocialWorldScene;
