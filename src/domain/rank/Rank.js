/* Valorant-style 25-tier rank system. Stored as 9 groups × shared cosmetic
 * data, each with the per-sub-tier band widths. Sub-tier (I/II/III) is
 * derived from the cumulative offset within the group. Radiant has no sub.
 *
 * Group boundaries (min ELO):
 *   Iron 0, Bronze 225, Silver 450, Gold 675, Platinum 900,
 *   Diamond 1200, Ascendant 1650, Immortal 2200, Radiant 3000.
 */

const GROUPS = [
  { group: 'Iron',      minElo: 0,    bands: [75, 75, 75],   color: '#8892a0', glow: 'rgba(136,146,160,0.5)',  icon: '◈' },
  { group: 'Bronze',    minElo: 225,  bands: [75, 75, 75],   color: '#c87941', glow: 'rgba(200,121,65,0.55)',  icon: '◉' },
  { group: 'Silver',    minElo: 450,  bands: [75, 75, 75],   color: '#c0c8d8', glow: 'rgba(192,200,216,0.55)', icon: '◇' },
  { group: 'Gold',      minElo: 675,  bands: [75, 75, 75],   color: '#d4a017', glow: 'rgba(212,160,23,0.6)',   icon: '◆' },
  { group: 'Platinum',  minElo: 900,  bands: [100, 100, 100],color: '#22d3ee', glow: 'rgba(34,211,238,0.55)',  icon: '⬡' },
  { group: 'Diamond',   minElo: 1200, bands: [150, 150, 150],color: '#60a5fa', glow: 'rgba(96,165,250,0.6)',   icon: '◈' },
  { group: 'Ascendant', minElo: 1650, bands: [150, 200, 200],color: '#00d68f', glow: 'rgba(0,214,143,0.6)',    icon: '⬟' },
  { group: 'Immortal',  minElo: 2200, bands: [250, 250, 300],color: '#f43f5e', glow: 'rgba(244,63,94,0.6)',    icon: '⬥' },
  { group: 'Radiant',   minElo: 3000, bands: null,           color: '#fde047', glow: 'rgba(253,224,71,0.7)',   icon: '✦' },
];

const SUB = ['I', 'II', 'III'];
const GROUP_ORDER = GROUPS.map(({ group }) => group);

const RANK_GROUP_BENEFITS = {
  Iron: {
    rankUpHeadline: 'Welcome to Iron',
    echoFillers: true,
    rewards: [
      'Pair Match is always a fixed 60-minute rated 2v2.',
      'Echo fillers can join when the candidate pool is too small.',
    ],
    promotionBullets: [
      'Pair Match uses the same fixed contract at every rank.',
      'Echo fillers can join when the candidate pool is too small.',
    ],
  },
  Bronze: {
    rankUpHeadline: 'Welcome to Bronze',
    echoFillers: true,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Echo fillers can still cover small candidate pools.',
    ],
    promotionBullets: [
      'Echo fillers still permitted when the candidate pool is too small.',
    ],
  },
  Silver: {
    rankUpHeadline: 'Welcome to Silver',
    echoFillers: false,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Matchmaking uses real profiles only.',
    ],
    promotionBullets: [
      'Echo fillers are no longer allowed. You need 3 real candidate profiles in range to start a match.',
      'If matchmaking fails, create more profiles to grow the pool.',
    ],
  },
  Gold: {
    rankUpHeadline: 'Welcome to Gold',
    echoFillers: false,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Real-profile matchmaking continues.',
    ],
    promotionBullets: [
      'Same matchmaking rules as Silver.',
    ],
  },
  Platinum: {
    rankUpHeadline: 'Welcome to Platinum',
    echoFillers: false,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Real-profile matchmaking continues.',
    ],
    promotionBullets: [
      'The arena contract remains fixed; rank changes matchmaking competition, not duration.',
      'Real-profile matchmaking continues.',
    ],
  },
  Diamond: {
    rankUpHeadline: 'Welcome to Diamond',
    echoFillers: false,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Real-profile matchmaking continues.',
    ],
    promotionBullets: [
      'Same as Platinum.',
      'Pair Match remains a fixed 60-minute rated 2v2.',
    ],
  },
  Ascendant: {
    rankUpHeadline: 'Welcome to Ascendant',
    echoFillers: false,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Real-profile matchmaking continues.',
    ],
    promotionBullets: [
      'The arena contract remains fixed; rank changes matchmaking competition, not duration.',
    ],
  },
  Immortal: {
    rankUpHeadline: 'Welcome to Immortal',
    echoFillers: false,
    rewards: [
      'Pair Match remains a fixed 60-minute rated 2v2.',
      'Elite-tier matchmaking rules continue.',
    ],
    promotionBullets: [
      'Same rules as Ascendant.',
    ],
  },
  Radiant: {
    rankUpHeadline: 'Welcome to Radiant',
    echoFillers: false,
    rewards: [
      'Top tier reached.',
      'Pair Match remains a fixed 60-minute rated 2v2.',
    ],
    promotionBullets: [
      "You've reached the top tier.",
      'Same rules as Immortal - no further unlocks.',
    ],
  },
};

function normalizeGroupName(group = 'Iron') {
  return GROUP_ORDER.includes(group) ? group : 'Iron';
}

export function getRankBenefitsForGroup(group = 'Iron') {
  const name = normalizeGroupName(group);
  const benefits = RANK_GROUP_BENEFITS[name];
  return {
    group: name,
    ...benefits,
    matchContract: 'Pair Match · 60 minutes · rated · 2v2',
  };
}

export function getAllRankBenefits() {
  return GROUP_ORDER.map((group) => getRankBenefitsForGroup(group));
}

export function getNextRankGroupName(group = 'Iron') {
  const idx = GROUP_ORDER.indexOf(normalizeGroupName(group));
  return idx >= 0 && idx < GROUP_ORDER.length - 1 ? GROUP_ORDER[idx + 1] : null;
}

export function getRank(elo = 0) {
  const e = Math.max(0, Number(elo) || 0);
  // Walk descending so the open-ended Radiant catches anything ≥ 3000.
  let g = GROUPS[0];
  for (let i = GROUPS.length - 1; i >= 0; i -= 1) {
    if (e >= GROUPS[i].minElo) { g = GROUPS[i]; break; }
  }
  if (!g.bands) {
    return { group: g.group, sub: '', minElo: g.minElo, maxElo: Infinity, color: g.color, glow: g.glow, icon: g.icon };
  }
  // Find which sub-tier band contains `e`.
  let offset = g.minElo;
  for (let i = 0; i < g.bands.length; i += 1) {
    const next = offset + g.bands[i];
    if (e < next || i === g.bands.length - 1) {
      return {
        group: g.group, sub: SUB[i],
        minElo: offset, maxElo: next - 1,
        color: g.color, glow: g.glow, icon: g.icon,
      };
    }
    offset = next;
  }
  return null;
}

export function getRankGroupPresentation(group = 'Iron') {
  const normalized = normalizeGroupName(String(group || '').trim());
  const presentation = GROUPS.find((entry) => entry.group === normalized) || GROUPS[0];
  return Object.freeze({
    group: presentation.group,
    color: presentation.color,
    glow: presentation.glow || null,
    icon: presentation.icon,
  });
}

export function getRankLabel(elo = 0) {
  const r = getRank(elo);
  return r.sub ? `${r.group.toUpperCase()} ${r.sub}` : r.group.toUpperCase();
}

// Stable zero-based ordinal for comparing established competitive bands.
// This deliberately exposes only the existing rank taxonomy; callers should
// not treat the ordinal as a user-facing score.
export function getRankBandOrdinal(elo = 0) {
  const rank = getRank(elo);
  const groupIndex = GROUP_ORDER.indexOf(rank.group);
  if (groupIndex < 0) return 0;
  let ordinal = 0;
  for (let index = 0; index < groupIndex; index += 1) {
    ordinal += GROUPS[index].bands?.length || 1;
  }
  const subIndex = SUB.indexOf(rank.sub);
  return ordinal + (subIndex >= 0 ? subIndex : 0);
}

export function getRankProgress(elo = 0) {
  const e = Math.max(0, Number(elo) || 0);
  const r = getRank(e);
  if (r.maxElo === Infinity) return 100;
  return Math.min(100, Math.floor(((e - r.minElo) / (r.maxElo - r.minElo + 1)) * 100));
}

export function getRankProgressDetails(elo = 0) {
  const e = Math.max(0, Math.floor(Number(elo) || 0));
  const current = getRank(e);
  const progress = getRankProgress(e);
  const currentLabel = getRankLabel(e);
  const isMaxRank = current.maxElo === Infinity;
  const nextElo = isMaxRank ? null : current.maxElo + 1;
  const next = nextElo == null ? null : getRank(nextElo);
  const nextLabel = nextElo == null ? 'MAX RANK' : getRankLabel(nextElo);
  const levelSpan = isMaxRank ? 0 : current.maxElo - current.minElo + 1;
  const levelElo = isMaxRank ? 0 : Math.min(levelSpan, Math.max(0, e - current.minElo));
  const nextGroupName = next?.group !== current.group ? next?.group : getNextRankGroupName(current.group);

  return {
    elo: e,
    current,
    currentLabel,
    currentBenefits: getRankBenefitsForGroup(current.group),
    progress,
    isMaxRank,
    levelElo,
    levelSpan,
    next,
    nextLabel,
    nextElo,
    eloToNext: nextElo == null ? 0 : Math.max(0, nextElo - e),
    unlocksNewGroup: !!next && next.group !== current.group,
    nextBenefits: next ? getRankBenefitsForGroup(next.group) : null,
    nextGroupBenefits: nextGroupName ? getRankBenefitsForGroup(nextGroupName) : null,
  };
}

export function getRankGlow(elo = 0, size = 16) {
  const { glow } = getRank(elo);
  return `0 0 ${size}px ${glow}, 0 0 ${size * 2.2}px ${glow}`;
}

export const getRankClass = (elo = 0) => getRank(elo).group.toLowerCase();

/**
 * Canonical live-profile rank presentation.
 *
 * A stored Elo value is also the historical baseline used to replay rated
 * matches, so its presence alone does not establish a public rank. Live
 * profile surfaces must opt in with rated-result evidence.
 */
export function getPlayerRankPresentation(player = {}, { glowSize = 16 } = {}) {
  const elo = Math.max(0, Number(player?.displayElo ?? player?.elo) || 0);
  const hasVisibleRating = player?.hasVisibleRating === true;
  const rank = hasVisibleRating ? getRank(elo) : null;
  return Object.freeze({
    elo,
    hasVisibleRating,
    rank,
    rankGroup: rank?.group || null,
    rankLabel: hasVisibleRating
      ? String(player?.rankLabel || getRankLabel(elo))
      : 'Unrated',
    rankClass: hasVisibleRating ? getRankClass(elo) : 'unrated',
    rankProgress: hasVisibleRating ? getRankProgress(elo) : 0,
    rankGlow: hasVisibleRating ? getRankGlow(elo, glowSize) : 'none',
  });
}

/** Floor of the player's major rank group (e.g. Gold II → 675). Used to
 *  prevent ELO from dropping below the major-rank boundary on a loss. */
export function getRankGroupFloor(elo = 0) {
  const { group } = getRank(elo);
  return GROUPS.find((g) => g.group === group)?.minElo ?? 0;
}

/* ──────────────────────────────────────────────────────────────────────
 * Matchmaking / dojo availability helpers
 * ──────────────────────────────────────────────────────────────────────
 * These centralise the rank-tier policy decisions so callers (Lobby,
 * MatchArena, GameHub, Match.js, the rank-up modal) all share a single
 * source of truth keyed off `getRank().group`. Per-spec table:
 *
 * Pair Match duration and rules are fixed at every rank. Only the
 * synthetic-filler availability policy varies by rank.
 *
 * Dojo training is rank-agnostic and available to every profile.
 */

/** Echo (synthetic) ghost fillers permitted only at the lowest two tiers. */
export function isEchoAllowed(elo = 0) {
  return getRankBenefitsForGroup(getRank(elo).group).echoFillers;
}

/** Numeric index of the rank group, useful for "did the player go up?" checks. */
export function getRankGroupIndex(elo = 0) {
  return GROUP_ORDER.indexOf(getRank(elo).group);
}
