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
  const source = player && typeof player === 'object' ? player : {};
  const activeCosmetics = source.activeCosmetics || {};
  const profileId = cleanId(source.profileId ?? source.UUID ?? source.id);
  const elo = Math.max(0, Number(rank?.elo ?? source.elo) || 0);
  const explicitRank = rank !== null && rank !== undefined;
  const rankPresentation = getPlayerRankPresentation({
    ...source,
    elo,
    hasVisibleRating: explicitRank || source.hasVisibleRating === true,
  });
  const suppliedRankGroup = firstDefined(rank?.group, source.rankGroup);
  const rankGroup = suppliedRankGroup
    ? getRankGroupPresentation(suppliedRankGroup).group
    : getRank(elo).group;
  const suppliedRankLabel = typeof rank === 'string'
    ? rank
    : rank?.label || source.rankLabel || null;

  return Object.freeze({
    profileId,
    username: String(source.username || source.name || 'Unknown profile'),
    profilePicture: firstDefined(source.profilePicture, source.avatar),
    title: firstDefined(source.title, source.activeTitle, activeCosmetics.title),
    frame: firstDefined(
      activeCosmetics.avatarFrame,
      source.frame,
      source.profileFrame,
      source.cardFrame,
      activeCosmetics.profileFrame,
      activeCosmetics.cardFrame,
      activeCosmetics.frame,
    ),
    theme: firstDefined(source.theme, source.playerTheme, activeCosmetics.profileTheme, activeCosmetics.appTheme, activeCosmetics.theme, 'minimalist'),
    elo,
    hasVisibleRating: rankPresentation.hasVisibleRating,
    rankGroup,
    rankLabel: rankPresentation.hasVisibleRating
      ? String(suppliedRankLabel || rankPresentation.rankLabel)
      : 'Unrated',
    snapshotAt: snapshotAt || source.snapshotAt || null,
  });
}

export default buildProfileIdentity;
