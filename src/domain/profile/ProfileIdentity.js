import {
  getPlayerRankPresentation,
  getRank,
  getRankGroupPresentation,
} from '../rank/Rank.js';

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function cleanId(value) {
  const id = String(value ?? '').trim();
  return id || null;
}

/**
 * Canonical presentation identity shared by live social surfaces and
 * immutable historical snapshots. Dynamic social roles intentionally do not
 * participate in this model.
 */
export function buildProfileIdentity(player = {}, { rank = null, snapshotAt = null } = {}) {
  const activeCosmetics = player.activeCosmetics || {};
  const profileId = cleanId(player.profileId ?? player.UUID ?? player.id);
  const elo = Math.max(0, Number(rank?.elo ?? player.elo) || 0);
  const explicitRank = rank !== null && rank !== undefined;
  const rankPresentation = getPlayerRankPresentation({
    ...player,
    elo,
    hasVisibleRating: explicitRank || player.hasVisibleRating === true,
  });
  const suppliedRankGroup = firstDefined(rank?.group, player.rankGroup);
  const rankGroup = suppliedRankGroup
    ? getRankGroupPresentation(suppliedRankGroup).group
    : getRank(elo).group;
  const suppliedRankLabel = typeof rank === 'string'
    ? rank
    : rank?.label || player.rankLabel || null;

  return Object.freeze({
    profileId,
    username: String(player.username || player.name || 'Unknown profile'),
    profilePicture: firstDefined(player.profilePicture, player.avatar),
    title: firstDefined(player.title, player.activeTitle, activeCosmetics.title),
    frame: firstDefined(
      activeCosmetics.avatarFrame,
      player.frame,
      player.profileFrame,
      player.cardFrame,
      activeCosmetics.profileFrame,
      activeCosmetics.cardFrame,
      activeCosmetics.frame,
    ),
    theme: firstDefined(player.theme, player.playerTheme, activeCosmetics.profileTheme, activeCosmetics.appTheme, activeCosmetics.theme, 'minimalist'),
    elo,
    hasVisibleRating: rankPresentation.hasVisibleRating,
    rankGroup,
    rankLabel: rankPresentation.hasVisibleRating
      ? String(suppliedRankLabel || rankPresentation.rankLabel)
      : 'Unrated',
    snapshotAt: snapshotAt || player.snapshotAt || null,
  });
}

export default buildProfileIdentity;
