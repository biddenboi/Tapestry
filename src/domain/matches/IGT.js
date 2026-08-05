import { getRankGroupFloor } from '@domain/rank/Rank.js';
import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';
import { getMatchTeams } from '@domain/matches/MatchContracts.js';
import { isRatedMatch } from '@domain/matches/RatingMode.js';

export const IGT_ORIGIN = 0;

export function getRecordIGT(record, { completed = false } = {}) {
  if (!record) return IGT_ORIGIN;
  const value = completed
    ? record.completedInGameTimestamp ?? record.result?.inGameTimestamp ?? record.inGameTimestamp
    : record.inGameTimestamp;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? Math.max(IGT_ORIGIN, timestamp) : IGT_ORIGIN;
}

export function getReliableMatchCompletionIGT(match) {
  const candidates = [
    match?.completedInGameTimestamp,
    match?.result?.inGameTimestamp,
  ];
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= IGT_ORIGIN) return numeric;
  }
  return null;
}

export function isRecordVisibleAtIGT(record, viewerIGT, options) {
  const limit = Number(viewerIGT);
  if (!Number.isFinite(limit)) return true;
  return getRecordIGT(record, options) <= Math.max(0, limit);
}

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getMatchEloChange(match, playerUUID) {
  if (!match?.result || !playerUUID) return null;
  const projected = match.result.playerEloChanges?.[playerUUID];
  if (projected) {
    return {
      ...projected,
      oldElo: optionalFiniteNumber(projected.oldElo),
      newElo: optionalFiniteNumber(projected.newElo),
      change: optionalFiniteNumber(projected.change) ?? 0,
    };
  }
  if (String(match.parent) === String(playerUUID) && match.result.eloChange != null) {
    return {
      oldElo: optionalFiniteNumber(match.result.oldElo),
      newElo: optionalFiniteNumber(match.result.newElo),
      change: optionalFiniteNumber(match.result.eloChange) ?? 0,
      breakdown: match.result.eloBreakdown || [],
    };
  }
  return null;
}

/**
 * A Match roster is an immutable competition snapshot. Its Elo value is the
 * pre-match value replayed at that point in IGT, not the participant's live
 * profile Elo. Rated reports therefore make that snapshot explicitly visible
 * to the shared identity presenter.
 */
export function buildCompetitionRankIdentity(match, participant = {}) {
  const change = getMatchEloChange(match, participant.UUID);
  const snapshotElo = Number(participant.elo);
  const recordedOldElo = Number(change?.oldElo);
  const hasSnapshotElo = participant.elo != null && Number.isFinite(snapshotElo);
  const hasRecordedOldElo = change?.oldElo != null && Number.isFinite(recordedOldElo);
  // A recorded result is the strongest evidence for the pre-match value.
  // Some legacy roster snapshots stored a placeholder `0` even though the
  // result retained the correct old Elo.
  const elo = hasRecordedOldElo
    ? Math.max(0, recordedOldElo)
    : hasSnapshotElo ? Math.max(0, snapshotElo) : 0;
  return {
    ...participant,
    elo,
    hasVisibleRating: isRatedMatch(match) && (hasSnapshotElo || hasRecordedOldElo),
    snapshotAt: match?.createdAt || participant.snapshotAt || null,
  };
}

export function getHistoricalBaseElo(player, matches) {
  const changes = (matches || [])
    .filter(isRatedMatch)
    .filter((match) => getReliableMatchCompletionIGT(match) != null)
    .map((match) => ({
      timestamp: getRecordIGT(match, { completed: true }),
      change: getMatchEloChange(match, player?.UUID),
    }))
    .filter((entry) => entry.change)
    .sort((a, b) => a.timestamp - b.timestamp);

  const earliestOldElo = optionalFiniteNumber(changes[0]?.change?.oldElo);
  if (earliestOldElo != null) return Math.max(0, earliestOldElo);

  if (changes.length) {
    const totalChange = changes.reduce((sum, entry) => sum + Number(entry.change.change || 0), 0);
    return Math.max(0, Number(player?.elo || 0) - totalChange);
  }

  return Math.max(0, Number(player?.igtBaseElo ?? player?.elo ?? 0));
}

function sortMatchesByIGT(matches) {
  return [...(matches || [])].sort((a, b) => {
    const timeDiff = getRecordIGT(a, { completed: true }) - getRecordIGT(b, { completed: true });
    if (timeDiff !== 0) return timeDiff;
    const wallDiff = String(a.result?.concludedAt || a.createdAt || '')
      .localeCompare(String(b.result?.concludedAt || b.createdAt || ''));
    return wallDiff || String(a.UUID || '').localeCompare(String(b.UUID || ''));
  });
}

function matchIncludesPlayer(match, playerUUID) {
  const id = String(playerUUID || '');
  if (!id) return false;
  if (String(match?.parent || '') === id) return true;
  if ((match?.participantUUIDs || []).some((UUID) => String(UUID) === id)) return true;
  return getMatchTeams(match).flat()
    .some((participant) => String(participant?.UUID || '') === id);
}

function participantSnapshotElo(match, playerUUID) {
  const participant = getMatchTeams(match).flat()
    .find((entry) => String(entry?.UUID || '') === String(playerUUID || ''));
  return optionalFiniteNumber(participant?.elo);
}

/**
 * Build one complete Elo evidence stream, then place the authoritative current
 * player Elo at the latest point where it is knowable. This preserves recorded
 * match-time values before that point while preventing incomplete legacy
 * receipts from leaving the present-day profile at a stale or placeholder Elo.
 */
export function buildPlayerEloTimeline(player, matches, {
  reconcileCurrent = true,
} = {}) {
  const playerUUID = String(player?.UUID || '');
  const evidence = sortMatchesByIGT(matches)
    .filter((match) => match?.status === 'complete' && isRatedMatch(match))
    .filter((match) => getReliableMatchCompletionIGT(match) != null)
    .filter((match) => matchIncludesPlayer(match, playerUUID))
    .map((match) => ({ match, change: getMatchEloChange(match, playerUUID) }));
  const baseElo = getHistoricalBaseElo(player, matches);
  let runningElo = baseElo;
  const ratedResults = evidence.map(({ match, change }) => {
    const snapshotElo = participantSnapshotElo(match, playerUUID);
    const storedOldElo = optionalFiniteNumber(change?.oldElo);
    const storedNewElo = optionalFiniteNumber(change?.newElo);
    const oldElo = storedOldElo == null
      ? snapshotElo == null ? runningElo : Math.max(0, snapshotElo)
      : Math.max(0, storedOldElo);
    const newElo = storedNewElo == null
      ? Math.max(0, oldElo + Number(change?.change || 0))
      : Math.max(0, storedNewElo);
    runningElo = newElo;
    return {
      matchUUID: String(match.UUID || ''),
      completedIGT: getReliableMatchCompletionIGT(match),
      concludedAt: match.result?.concludedAt || match.createdAt || null,
      oldElo,
      newElo,
      change: newElo - oldElo,
      inferredParticipation: !change,
    };
  });
  const lastResultIGT = ratedResults.length
    ? Math.max(...ratedResults.map((result) => Number(result.completedIGT || 0)))
    : null;
  const playerIGT = optionalFiniteNumber(player?.inGameTime);
  const canonicalElo = reconcileCurrent && ratedResults.length
    ? Math.max(0, Number(player?.elo || 0))
    : null;
  const canonicalAtIGT = canonicalElo == null
    ? null
    : Math.max(lastResultIGT || 0, playerIGT == null ? 0 : Math.max(0, playerIGT));

  return {
    baseElo,
    ratedResults,
    canonicalElo,
    canonicalAtIGT,
  };
}

export function projectPlayerEloTimeline(timeline = {}, viewerIGT = Infinity) {
  const value = Number(viewerIGT);
  const boundary = Number.isFinite(value) ? Math.max(0, value) : Infinity;
  const visibleRatedResults = [...(timeline.ratedResults || [])]
    .filter((result) => Number(result.completedIGT || 0) <= boundary)
    .sort((left, right) => (
      Number(left.completedIGT || 0) - Number(right.completedIGT || 0)
      || String(left.concludedAt || '').localeCompare(String(right.concludedAt || ''))
      || String(left.matchUUID || '').localeCompare(String(right.matchUUID || ''))
    ));
  const latest = visibleRatedResults.at(-1) || null;
  const canonicalAtIGT = optionalFiniteNumber(timeline.canonicalAtIGT);
  const canonicalElo = optionalFiniteNumber(timeline.canonicalElo);
  const canonicalVisible = canonicalAtIGT != null
    && canonicalElo != null
    && canonicalAtIGT <= boundary
    && visibleRatedResults.length > 0;
  const elo = canonicalVisible
    ? Math.max(0, canonicalElo)
    : latest
      ? Math.max(0, Number(latest.newElo || 0))
      : Math.max(0, Number(timeline.baseElo || 0));
  const eloHistory = visibleRatedResults.length ? [
    {
      t: Math.max(0, Number(visibleRatedResults[0].completedIGT || 0) - 1),
      elo: Math.max(0, Number(
        visibleRatedResults[0].oldElo
        ?? timeline.baseElo
        ?? 0
      )),
      baseline: true,
    },
    ...visibleRatedResults.map((result) => ({
      t: Number(result.completedIGT || 0),
      elo: Math.max(0, Number(result.newElo || 0)),
      matchUUID: result.matchUUID,
    })),
  ] : [];
  if (
    canonicalVisible
    && eloHistory.length
    && Number(eloHistory.at(-1).elo) !== Number(elo)
  ) {
    eloHistory.push({
      t: canonicalAtIGT,
      elo,
      canonical: true,
    });
  }

  return {
    elo,
    eloHistory,
    visibleRatedResults,
    hasVisibleRating: visibleRatedResults.length > 0,
    firstRatedIGT: visibleRatedResults[0]?.completedIGT ?? null,
    canonicalVisible,
  };
}

export function replayEloTimeline(players, visibleMatches) {
  const matches = sortMatchesByIGT(visibleMatches)
    .filter(isRatedMatch)
    .filter((entry) => getReliableMatchCompletionIGT(entry) != null);
  const ratings = Object.fromEntries((players || []).map((player) => [
    String(player.UUID),
    getHistoricalBaseElo(player, matches),
  ]));
  const ratedPlayerIds = new Set();
  const replayedMatches = [];

  for (const match of matches) {
    const teams = getMatchTeams(match).map((team) => (team || []).map((participant) => {
      const participantUUID = String(participant?.UUID || '');
      return ratings[participantUUID] == null
        ? participant
        : { ...participant, elo: ratings[participantUUID] };
    }));

    const playerEloChanges = {};
    for (const participant of teams.flat()) {
      const participantUUID = String(participant?.UUID || '');
      if (!participantUUID || ratings[participantUUID] == null) continue;
      const storedChange = getMatchEloChange(match, participantUUID);
      if (!storedChange) continue;
      const storedOldElo = optionalFiniteNumber(storedChange.oldElo);
      const storedNewElo = optionalFiniteNumber(storedChange.newElo);
      const oldElo = storedOldElo == null
        ? ratings[participantUUID]
        : Math.max(0, storedOldElo);
      const rawChange = Number(storedChange.change || 0);
      const newElo = storedNewElo == null
        ? Math.max(getRankGroupFloor(oldElo), oldElo + rawChange)
        : Math.max(0, storedNewElo);
      playerEloChanges[participantUUID] = {
        oldElo,
        newElo,
        change: newElo - oldElo,
        breakdown: storedChange.breakdown || [],
      };
      ratings[participantUUID] = newElo;
      ratedPlayerIds.add(participantUUID);
    }

    const ownerChange = playerEloChanges[String(match.parent)];
    replayedMatches.push({
      ...match,
      teams,
      result: {
        ...match.result,
        playerEloChanges,
        ...(ownerChange ? {
          oldElo: ownerChange.oldElo,
          newElo: ownerChange.newElo,
          eloChange: ownerChange.change,
          eloBreakdown: ownerChange.breakdown,
        } : {}),
      },
    });
  }

  return {
    players: (players || []).map((player) => ({
      ...player,
      elo: ratings[String(player.UUID)] ?? Math.max(0, Number(player.igtBaseElo ?? player.elo ?? 0)),
      hasVisibleRating: ratedPlayerIds.has(String(player.UUID)),
    })),
    matches: replayedMatches,
  };
}

export function projectPlayersAtIGT(players, visibleMatches) {
  return replayEloTimeline(players, visibleMatches).players;
}

export function withPlayerMatchResult(match, playerUUID) {
  const playerChange = getMatchEloChange(match, playerUUID);
  const outcome = getMatchOutcomeForPlayer(match, playerUUID);
  return {
    ...match,
    result: {
      ...match.result,
      iWon: outcome.won,
      viewerTeamIdx: outcome.playerTeamIdx,
      viewerOutcome: outcome.status,
      ...(playerChange ? {
        eloChange: playerChange.change,
        oldElo: playerChange.oldElo,
        newElo: playerChange.newElo,
        eloBreakdown: playerChange.breakdown || match.result?.eloBreakdown || [],
      } : {}),
    },
  };
}
