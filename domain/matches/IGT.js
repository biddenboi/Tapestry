import { computeEloChanges } from '@domain/matches/Elo.js';
import { getRankGroupFloor } from '@domain/rank/Rank.js';
import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';

export const LEGACY_IGT = 0;

export function getRecordIGT(record, { completed = false } = {}) {
  if (!record) return LEGACY_IGT;
  if (completed) {
    const completedIGT = Number(
      record.completedInGameTimestamp
      ?? record.result?.inGameTimestamp,
    );
    if (Number.isFinite(completedIGT)) return Math.max(0, completedIGT);
  }
  const timestamp = Number(record.inGameTimestamp);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp) : LEGACY_IGT;
}

export function isRecordVisibleAtIGT(record, viewerIGT, options) {
  const limit = Number(viewerIGT);
  if (!Number.isFinite(limit)) return true;
  return getRecordIGT(record, options) <= Math.max(0, limit);
}

export function getMatchEloChange(match, playerUUID) {
  if (!match?.result || !playerUUID) return null;
  const projected = match.result.playerEloChanges?.[playerUUID];
  if (projected) return projected;
  if (String(match.parent) === String(playerUUID) && match.result.eloChange != null) {
    return {
      oldElo: Number(match.result.oldElo || 0),
      newElo: Number(match.result.newElo || 0),
      change: Number(match.result.eloChange || 0),
    };
  }
  return null;
}

export function inferLegacyRecordIGT(record, player, dateFields = ['createdAt'], now = Date.now()) {
  const existing = Number(record?.inGameTimestamp);
  if (Number.isFinite(existing) && existing > 0) return existing;
  if (!player) return 60000;

  const createdAt = new Date(player.createdAt).getTime();
  const actionAt = dateFields
    .map((field) => field.split('.').reduce((value, key) => value?.[key], record))
    .map((value) => new Date(value).getTime())
    .find(Number.isFinite);
  if (!Number.isFinite(createdAt) || !Number.isFinite(actionAt) || actionAt <= createdAt) {
    return 60000;
  }

  return Math.max(60000, Math.round(actionAt - createdAt));
}

export function getHistoricalBaseElo(player, matches) {
  const changes = (matches || [])
    .map((match) => ({
      timestamp: getRecordIGT(match, { completed: true }),
      change: getMatchEloChange(match, player?.UUID),
    }))
    .filter((entry) => entry.change)
    .sort((a, b) => a.timestamp - b.timestamp);

  const earliestOldElo = Number(changes[0]?.change?.oldElo);
  if (Number.isFinite(earliestOldElo)) return Math.max(0, earliestOldElo);

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

export function replayEloTimeline(players, visibleMatches) {
  const ratings = Object.fromEntries((players || []).map((player) => [
    String(player.UUID),
    Math.max(0, Number(player.igtBaseElo ?? player.elo ?? 0)),
  ]));
  const replayedMatches = [];

  for (const match of sortMatchesByIGT(visibleMatches)) {
    const teams = (match.teams || []).map((team) => (team || []).map((participant) => {
      const participantUUID = String(participant?.UUID || '');
      return ratings[participantUUID] == null
        ? participant
        : { ...participant, elo: ratings[participantUUID] };
    }));
    const storedChanges = match.result?.playerEloChanges || {};
    let rawChanges = storedChanges;

    if (match.result?.playerScores && teams.length >= 2) {
      const ownerOnTeam1 = teams[0].some((participant) => (
        String(participant.UUID) === String(match.parent)
      ));
      const forcedLoserTeamIdx = match.result.wasForfeited
        ? ownerOnTeam1 ? 0 : 1
        : null;
      rawChanges = computeEloChanges(
        teams,
        match.result.playerScores,
        forcedLoserTeamIdx,
      ).changes;
    } else if (
      match.parent
      && match.result?.eloChange != null
      && !rawChanges[match.parent]
    ) {
      rawChanges = {
        ...rawChanges,
        [match.parent]: {
          change: Number(match.result.eloChange || 0),
          breakdown: match.result.eloBreakdown || [],
        },
      };
    }

    const playerEloChanges = {};
    for (const participant of teams.flat()) {
      const participantUUID = String(participant?.UUID || '');
      if (!participantUUID || ratings[participantUUID] == null) continue;
      const oldElo = ratings[participantUUID];
      const rawChange = Number(rawChanges[participantUUID]?.change || 0);
      const newElo = Math.max(getRankGroupFloor(oldElo), oldElo + rawChange);
      playerEloChanges[participantUUID] = {
        oldElo,
        newElo,
        change: newElo - oldElo,
        breakdown: rawChanges[participantUUID]?.breakdown || [],
      };
      ratings[participantUUID] = newElo;
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
