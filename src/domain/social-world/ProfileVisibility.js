import { CAST_CAPACITY, VISIBILITY_TIER } from './SocialWorldContracts.js';

export const PROFILE_TAB = Object.freeze({
  overview: 'overview',
  context: 'context',
  history: 'history',
  competition: 'competition',
  identity: 'identity',
});

const ALL_OVERVIEW_BLOCKS = Object.freeze([
  'lifeContext', 'text', 'stats', 'achievements', 'activity', 'rankGraph', 'highlights', 'goalContribution',
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
    allowedTabs: Object.freeze([PROFILE_TAB.overview, PROFILE_TAB.context, PROFILE_TAB.history, PROFILE_TAB.competition]),
    daybookScope: 'full',
    matchScope: 'full',
    socialScope: 'full',
    settingsScope: 'none',
    overviewBlockTypes: ALL_OVERVIEW_BLOCKS,
    canViewRichLastActive: true,
  }),
  [VISIBILITY_TIER.dynamic]: Object.freeze({
    label: 'Current cast · limited',
    allowedTabs: Object.freeze([PROFILE_TAB.overview, PROFILE_TAB.context, PROFILE_TAB.history, PROFILE_TAB.competition]),
    daybookScope: 'recent',
    matchScope: 'summary',
    socialScope: 'current-threads',
    settingsScope: 'none',
    overviewBlockTypes: Object.freeze(['lifeContext', 'text', 'stats', 'achievements', 'activity', 'highlights', 'goalContribution']),
    canViewRichLastActive: false,
  }),
  [VISIBILITY_TIER.outside]: Object.freeze({
    label: 'Outside cast · overview only',
    allowedTabs: Object.freeze([PROFILE_TAB.overview]),
    daybookScope: 'none',
    matchScope: 'none',
    socialScope: 'none',
    settingsScope: 'none',
    overviewBlockTypes: Object.freeze(['lifeContext', 'text', 'achievements']),
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
  dynamicProfileIds = [],
  friendCount = friendIds.length,
} = {}) {
  const viewer = viewerId == null ? '' : String(viewerId);
  const profile = profileId == null ? '' : String(profileId);
  const friends = idSet(friendIds);
  const dynamic = idSet(dynamicProfileIds);
  const tier = viewer && viewer === profile
    ? VISIBILITY_TIER.self
    : friends.has(profile)
      ? VISIBILITY_TIER.friend
      : dynamic.has(profile)
        ? VISIBILITY_TIER.dynamic
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
    maxFriends: CAST_CAPACITY.maxFriends,
    emptyFriendSlots: Math.max(0, CAST_CAPACITY.maxFriends - normalizedFriendCount),
    isFriendCapacityFull: normalizedFriendCount >= CAST_CAPACITY.maxFriends,
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
