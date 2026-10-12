import { MAX_FRIENDS } from '../social/Friendship.js';

export const VISIBILITY_TIER = Object.freeze({ self: 'self', friend: 'friend', outside: 'outside' });

export const PROFILE_TAB = Object.freeze({
  overview: 'overview',
  friends: 'friends',
  history: 'history',
  competition: 'competition',
  identity: 'identity',
});

const ALL_OVERVIEW_BLOCKS = Object.freeze([
  'text', 'stats', 'achievements', 'activity', 'rankGraph', 'highlights', 'goalContribution',
]);

export const PROFILE_VISIBILITY_POLICY = Object.freeze({
  [VISIBILITY_TIER.self]: Object.freeze({
    label: 'Self · full access',
    allowedTabs: Object.freeze(Object.values(PROFILE_TAB)),
    daybookScope: 'full',
    matchScope: 'full',
    socialScope: 'full',
    settingsScope: 'full',
    overviewBlockTypes: ALL_OVERVIEW_BLOCKS,
    canViewRichLastActive: true,
  }),
  [VISIBILITY_TIER.friend]: Object.freeze({
    label: 'Friend',
    allowedTabs: Object.freeze([PROFILE_TAB.overview, PROFILE_TAB.friends, PROFILE_TAB.history, PROFILE_TAB.competition]),
    daybookScope: 'full',
    matchScope: 'full',
    socialScope: 'full',
    settingsScope: 'none',
    overviewBlockTypes: ALL_OVERVIEW_BLOCKS,
    canViewRichLastActive: true,
  }),
  [VISIBILITY_TIER.outside]: Object.freeze({
    label: 'Overview only',
    allowedTabs: Object.freeze([PROFILE_TAB.overview]),
    daybookScope: 'none',
    matchScope: 'none',
    socialScope: 'none',
    settingsScope: 'none',
    overviewBlockTypes: Object.freeze(['text', 'achievements']),
    canViewRichLastActive: false,
  }),
});

function idSet(values = []) {
  return new Set((values || []).map((value) => String(value)).filter(Boolean));
}

export function resolveProfileVisibility({
  viewerId,
  profileId,
  friendIds = [],
  friendCount = friendIds.length,
} = {}) {
  const viewer = viewerId == null ? '' : String(viewerId);
  const profile = profileId == null ? '' : String(profileId);
  const friends = idSet(friendIds);
  const tier = viewer && viewer === profile
    ? VISIBILITY_TIER.self
    : friends.has(profile)
      ? VISIBILITY_TIER.friend
      : VISIBILITY_TIER.outside;
  const policy = PROFILE_VISIBILITY_POLICY[tier];
  const normalizedFriendCount = Math.max(0, Math.trunc(Number(friendCount) || 0));
  return Object.freeze({
    viewerId: viewer,
    profileId: profile,
    tier,
    ...policy,
    allowedTabs: policy.allowedTabs,
    overviewBlockTypes: policy.overviewBlockTypes,
    friendCount: normalizedFriendCount,
    maxFriends: MAX_FRIENDS,
    emptyFriendSlots: Math.max(0, MAX_FRIENDS - normalizedFriendCount),
    isFriendCapacityFull: normalizedFriendCount >= MAX_FRIENDS,
    isSelf: tier === VISIBILITY_TIER.self,
  });
}

export function canAccessProfileTab(access, tab) {
  return access?.allowedTabs?.includes(String(tab)) === true;
}

export function filterProfileOverviewBlocks(personalization, access) {
  const allowed = new Set(access?.overviewBlockTypes || []);
  return {
    ...(personalization || {}),
    blocks: (personalization?.blocks || []).filter((block) => allowed.has(block?.type)),
  };
}
