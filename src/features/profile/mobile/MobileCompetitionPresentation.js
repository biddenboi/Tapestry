function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function compareProfiles(left, right) {
  return String(left?.username || left?.name || '').localeCompare(
    String(right?.username || right?.name || ''),
    undefined,
    { sensitivity: 'base', numeric: true },
  ) || String(left?.UUID || '').localeCompare(String(right?.UUID || ''));
}

function rankedRows(profiles, valueFor) {
  return [...profiles]
    .map((profile) => ({ profile, value: Math.round(numeric(valueFor(profile))) }))
    .sort((left, right) => right.value - left.value || compareProfiles(left.profile, right.profile))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function mobileRankingNeighborhood(rows = [], playerUUID, size = 3) {
  const source = Array.isArray(rows) ? rows : [];
  const count = Math.max(1, Math.trunc(Number(size) || 3));
  if (source.length <= count) return source;
  const index = source.findIndex(({ profile }) => String(profile?.UUID) === String(playerUUID));
  const leaders = source.slice(0, count);
  if (index < 0 || index < count) return leaders;
  // Mobile has room for a compact leaderboard, not the complete desktop
  // table. Always keep the actual leaders visible and append the viewer's
  // row when it falls outside that group. Centering on the viewer previously
  // made a zero-point player see only other zero rows and hid the saved totals.
  return [...leaders, source[index]];
}

export function buildMobileCompetitionPresentation({
  profiles = [],
  matchSnapshot = {},
  contributionSnapshot = {},
  matchProjection = {},
  currentPlayerUUID = null,
} = {}) {
  // Archiving prevents profile selection; it must not erase that profile's
  // historical competitive record. Desktop leaderboards retain archived
  // participants, so mobile must use the same population.
  const projectedByProfile = new Map(
    (matchProjection.participants || [])
      .filter((profile) => profile?.UUID)
      .map((profile) => [String(profile.UUID), profile]),
  );
  const liveProfiles = (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile?.UUID && !profile.bannedAt)
    .map((profile) => {
      const projected = projectedByProfile.get(String(profile.UUID));
      if (!projected) {
        return { ...profile, hasVisibleRating: false, rankGroup: null, rankLabel: null };
      }
      return {
        ...profile,
        elo: numeric(projected.elo),
        hasVisibleRating: Boolean(projected.hasVisibleRating),
        // Rank cosmetics must describe the same IGT projection as the value.
        // A persisted label may belong to a later point in this player's path.
        rankGroup: null,
        rankLabel: null,
        rankSub: null,
        subTier: null,
      };
    });
  const eloByProfile = Object.fromEntries(liveProfiles
    .filter((profile) => profile.hasVisibleRating)
    .map((profile) => [String(profile.UUID), numeric(profile.elo)]));
  const pointsByProfile = matchSnapshot.pointsByPlayer || {};
  const contributionByProfile = contributionSnapshot.totalsByPlayer || {};
  const rankings = Object.freeze({
    elo: Object.freeze(rankedRows(
      liveProfiles.filter((profile) => Object.hasOwn(eloByProfile, String(profile.UUID))),
      (profile) => eloByProfile[String(profile.UUID)],
    )),
    points: Object.freeze(rankedRows(liveProfiles, (profile) => pointsByProfile[String(profile.UUID)])),
    contribution: Object.freeze(rankedRows(liveProfiles, (profile) => contributionByProfile[String(profile.UUID)])),
  });
  const playerId = String(currentPlayerUUID || '');
  return Object.freeze({
    profiles: Object.freeze(liveProfiles),
    rankings,
    neighborhoods: Object.freeze(Object.fromEntries(
      Object.entries(rankings).map(([key, rows]) => [key, Object.freeze(mobileRankingNeighborhood(rows, playerId))]),
    )),
    metrics: Object.freeze({
      elo: Object.hasOwn(eloByProfile, playerId)
        ? Math.round(numeric(eloByProfile[playerId]))
        : null,
      points: Math.round(numeric(pointsByProfile[playerId])),
      contribution: Math.round(numeric(contributionByProfile[playerId])),
    }),
    eloHistory: Object.freeze([...(matchProjection.eloHistory || [])]),
  });
}
