import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { buildProfileViewModel } from '@domain/profile/Profile.js';
import { resolveProfileVisibility } from '@domain/social-world/ProfileVisibility.js';
import {
  projectContributionLeaderboardAtIGT,
  projectMatchLeaderboardAtIGT,
  readMaterializedLeaderboardSnapshotsSWR,
} from '@domain/leaderboards/MaterializedLeaderboards.js';

const safeRows = async (promise, label) => {
  try {
    return await promise;
  } catch (error) {
    console.warn(`[Profile] optional ${label} load failed:`, error);
    return [];
  }
};

export async function loadMaterializedProfileData({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
  viewerIGT = getCurrentIGT(currentPlayer),
}) {
  if (!profileUUID) return null;
  // Profile summaries intentionally omit full image payloads. Hydrate the
  // lightweight players domain and merge its live identity record so a
  // profile opened outside the feed resolves the same avatar as feed cards.
  await ensureDomainLoaded?.(['profiles', 'leaderboards']);
  const [
    summary,
    summaries,
    livePlayer,
    livePlayers,
    leaderboardSnapshots,
    viewedFriendships,
    viewerFriendships,
  ] = await Promise.all([
    databaseConnection.get(STORES.profileSummary, profileUUID),
    databaseConnection.getAll(STORES.profileSummary),
    databaseConnection.getProfilePlayer
      ? databaseConnection.getProfilePlayer(profileUUID)
      : databaseConnection.get(STORES.player, profileUUID),
    databaseConnection.getAllProfilePlayers
      ? databaseConnection.getAllProfilePlayers()
      : databaseConnection.getAll(STORES.player),
    readMaterializedLeaderboardSnapshotsSWR(databaseConnection),
    safeRows(databaseConnection.getFriendshipsForPlayer(profileUUID), 'viewed friendships'),
    currentPlayer?.UUID
      ? safeRows(databaseConnection.getFriendshipsForPlayer(currentPlayer.UUID), 'viewer friendships')
      : Promise.resolve([]),
  ]);
  const ratingProjection = projectMatchLeaderboardAtIGT(leaderboardSnapshots.match, {
    viewerIGT,
    playerUUID: profileUUID,
  });
  const projectedRating = ratingProjection.participants
    .find((entry) => String(entry.UUID) === String(profileUUID)) || null;
  const contributionProjection = projectContributionLeaderboardAtIGT(
    leaderboardSnapshots.contribution,
    { viewerIGT },
  );
  const fallbackPlayer = livePlayer
    || (currentPlayer?.UUID === profileUUID ? currentPlayer : null);
  const resolved = summary || (fallbackPlayer ? {
    UUID: profileUUID,
    player: fallbackPlayer,
    profileView: buildProfileViewModel({
      player: fallbackPlayer,
      history: [],
      matches: [],
      allPlayers: livePlayers,
      currentPlayerUUID: currentPlayer?.UUID,
      viewerIGT,
    }),
    recentTimelineEntries: [],
    recentMatches: [],
    friendUUIDs: [],
    contributionTotal: 0,
    contributionDistribution: [],
    ownedCosmeticIds: ['default'],
  } : null);
  const summaryPlayers = summaries.map((entry) => entry?.player).filter((entry) => entry?.UUID);
  const livePlayersByUUID = new Map(livePlayers.filter((entry) => entry?.UUID).map((entry) => [entry.UUID, entry]));
  const projectedPlayersByUUID = new Map(
    ratingProjection.participants.map((entry) => [String(entry.UUID), entry]),
  );
  const players = [...new Map([
    ...summaryPlayers.map((entry) => [entry.UUID, { ...entry, ...(livePlayersByUUID.get(entry.UUID) || {}) }]),
    ...livePlayers.map((entry) => [entry.UUID, entry]),
  ]).values()].map((entry) => {
    const projected = projectedPlayersByUUID.get(String(entry.UUID));
    return projected
      ? {
          ...entry,
          elo: projected.elo,
          hasVisibleRating: projected.hasVisibleRating,
        }
      : entry;
  });
  const resolvedPlayer = livePlayer
    ? { ...(resolved?.player || {}), ...livePlayer }
    : (resolved?.player || null);
  const contributionTotalsByPlayer = contributionProjection.totalsByPlayer || {};
  const contributionKey = Object.keys(contributionTotalsByPlayer)
    .find((UUID) => String(UUID) === String(profileUUID));
  const authoritativeContributionTotal = contributionKey == null
    ? Number(resolved?.contributionTotal || 0)
    : Math.max(0, Number(contributionTotalsByPlayer[contributionKey]) || 0);
  const resolvedSummary = resolved
    ? { ...resolved, contributionTotal: authoritativeContributionTotal }
    : null;
  const currentIGT = Math.max(0, Number(viewerIGT) || 0);
  const relationship = viewerFriendships.find((entry) => {
    if (!entry.players?.includes(profileUUID) || !entry.players?.includes(currentPlayer?.UUID)) return false;
    if (entry.requestedBy === currentPlayer?.UUID) return true;
    return currentIGT >= Number(entry.inGameTimestamp || 0);
  }) || null;
  const acceptedUUIDs = new Set(
    viewedFriendships
      .filter((entry) => entry.status === 'accepted')
      .flatMap((entry) => entry.players || [])
      .filter((UUID) => UUID !== profileUUID),
  );
  return {
    summary: resolvedSummary,
    player: resolvedPlayer,
    players,
    history: resolved?.profileView?.timelineEntries || resolved?.recentTimelineEntries || [],
    matches: resolved?.recentMatches || resolved?.profileView?.matchSummary?.recent || [],
    friends: players.filter((entry) => acceptedUUIDs.has(entry.UUID)),
    friendship: relationship,
    // Local visibility is intentionally not projected from a materialized profile
    // summary. A viewed profile's friendUUIDs describe that profile's own social
    // links and cannot authoritatively determine the viewer's friend/dynamic tier.
    // Profile.jsx obtains local access from getSocialWorldProfileAccess instead.
    ownedPassIds: new Set(resolved?.ownedCosmeticIds || ['default']),
    ratingProjection: {
      elo: projectedRating?.elo ?? null,
      hasVisibleRating: !!projectedRating?.hasVisibleRating,
      firstRatedIGT: projectedRating?.firstRatedIGT ?? null,
      eloHistory: ratingProjection.eloHistory,
    },
  };
}

export async function loadProfileAccessData({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
}) {
  if (!currentPlayer?.UUID || !profileUUID) return null;
  await Promise.all([
    ensureDomainLoaded?.('profileSocial'),
    ensureDomainLoaded?.('socialWorld'),
  ]);
  if (typeof databaseConnection.getSocialWorldProfileAccess !== 'function') return null;
  return databaseConnection.getSocialWorldProfileAccess({
    viewerId: currentPlayer.UUID,
    profileId: profileUUID,
    viewerIGT: getCurrentIGT(currentPlayer),
  });
}

export async function loadProfileTimelineData({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
  viewerIGT = getCurrentIGT(currentPlayer),
  daybookQuery = {},
}) {
  await ensureDomainLoaded('profileTimeline');
  const currentIGT = Math.max(0, Number(viewerIGT) || 0);
  const [player, daybook, contributions, goals, presence] = await Promise.all([
    databaseConnection.get(STORES.player, profileUUID),
    databaseConnection.getProfileDaybookPage({
      profileId: profileUUID,
      viewerIGT: currentIGT,
      dayLimit: 5,
      ...daybookQuery,
    }),
    safeRows(databaseConnection.getPlayerStoreThroughIGT(STORES.contribution, profileUUID, currentIGT), 'contribution timeline'),
    safeRows(databaseConnection.getAll(STORES.project), 'goal metadata'),
    typeof databaseConnection.getSocialWorldPresence === 'function'
      ? databaseConnection.getSocialWorldPresence({
          profileId: profileUUID,
          viewerIGT: currentIGT,
          isActiveProfile: profileUUID === currentPlayer?.UUID,
        }).catch((error) => {
          console.warn('[Profile] optional presence load failed:', error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const history = daybook.entries.filter((entry) => entry.type !== 'match');
  return { player, daybook, history, contributions, goals, presence };
}

export async function loadProfileDaybookPage({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
  viewerIGT = getCurrentIGT(currentPlayer),
  query = {},
}) {
  await ensureDomainLoaded('profileTimeline');
  return databaseConnection.getProfileDaybookPage({
    profileId: profileUUID,
    viewerIGT: Math.max(0, Number(viewerIGT) || 0),
    dayLimit: 5,
    ...query,
  });
}

export async function loadProfilePresence({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
  viewerIGT = getCurrentIGT(currentPlayer),
}) {
  await ensureDomainLoaded?.('presence');
  if (typeof databaseConnection.getSocialWorldPresence !== 'function') return null;
  return databaseConnection.getSocialWorldPresence({
    profileId: profileUUID,
    viewerIGT: Math.max(0, Number(viewerIGT) || 0),
    isActiveProfile: profileUUID === currentPlayer?.UUID,
  });
}

export async function loadProfileMatchData({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
}) {
  await ensureDomainLoaded('profileMatches');
  const currentIGT = getCurrentIGT(currentPlayer);
  const matches = await safeRows(
    databaseConnection.getProfileMatchesForPlayer(profileUUID, currentIGT),
    'match detail',
  );
  return matches.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}

export async function loadProfileSocialData({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
  profileUUID,
  players,
}) {
  await ensureDomainLoaded('profileSocial');
  const currentIGT = getCurrentIGT(currentPlayer);
  const [viewedFriendships, viewerFriendships] = await Promise.all([
    safeRows(databaseConnection.getFriendshipsForPlayer(profileUUID), 'viewed friendships'),
    currentPlayer?.UUID
      ? safeRows(databaseConnection.getFriendshipsForPlayer(currentPlayer.UUID), 'viewer friendships')
      : Promise.resolve([]),
  ]);
  const acceptedUUIDs = new Set(
    viewedFriendships
      .filter((entry) => entry.status === 'accepted')
      .flatMap((entry) => entry.players || [])
      .filter((UUID) => UUID !== profileUUID),
  );
  const friendship = viewerFriendships.find((entry) => {
    if (!entry.players?.includes(profileUUID) || !entry.players?.includes(currentPlayer?.UUID)) return false;
    if (entry.requestedBy === currentPlayer?.UUID) return true;
    return currentIGT >= Number(entry.inGameTimestamp || 0);
  }) || null;
  return {
    friends: players.filter((entry) => acceptedUUIDs.has(entry.UUID)),
    friendship,
  };
}

export async function loadProfileInventoryData({
  databaseConnection,
  ensureDomainLoaded,
  currentPlayer,
}) {
  await ensureDomainLoaded('profileInventory');
  const inventoryRows = await safeRows(
    databaseConnection.getPlayerStore(STORES.inventory, currentPlayer.UUID),
    'profile inventory',
  );
  return new Set([
    'default',
    ...inventoryRows.flatMap((item) => [item.type, item.itemId, item.name?.toLowerCase()].filter(Boolean)),
  ]);
}
