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
  if (index < 0) return source.slice(0, count);
  const leading = Math.floor((count - 1) / 2);
  const start = Math.max(0, Math.min(source.length - count, index - leading));
  return source.slice(start, start + count);
}

export function buildMobileCompetitionPresentation({
  profiles = [],
  matchSnapshot = {},
  contributionSnapshot = {},
  matchProjection = {},
  currentPlayerUUID = null,
} = {}) {
  const liveProfiles = (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile?.UUID && !profile.archivedAt && !profile.bannedAt);
  const eloByProfile = Object.fromEntries(
    (matchProjection.participants || []).map((profile) => [String(profile.UUID), numeric(profile.elo)]),
  );
  const pointsByProfile = matchSnapshot.pointsByPlayer || {};
  const contributionByProfile = contributionSnapshot.totalsByPlayer || {};
  const rankings = Object.freeze({
    elo: Object.freeze(rankedRows(liveProfiles, (profile) => eloByProfile[String(profile.UUID)])),
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
      elo: Math.round(numeric(eloByProfile[playerId])),
      points: Math.round(numeric(pointsByProfile[playerId])),
      contribution: Math.round(numeric(contributionByProfile[playerId])),
    }),
    eloHistory: Object.freeze([...(matchProjection.eloHistory || [])]),
  });
}

