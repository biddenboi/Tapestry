import { HOUR, STORES } from '@domain/constants.js';
import { getCanonicalTaskPoints, getTaskDuration } from '@domain/tasks/Tasks.js';
import { isEchoAllowed } from '@domain/rank/Rank.js';
import { getPlayerActivityState } from '@domain/matches/MatchActivity.js';
import {
  getMatchDurationHours,
  getMatchTeams,
  PAIR_MATCH_MAX_TEAM_RATING_GAP,
  PAIR_MATCH_RATING_RANGE,
} from '@domain/matches/MatchContracts.js';

// Deterministic helpers
const hashString = (s = '') => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (((h << 5) - h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const seededRandom = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const getCompletedMatchIGT = (match) => {
  for (const value of [match?.completedInGameTimestamp, match?.result?.inGameTimestamp]) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const startIGT = Number(match?.inGameTimestamp);
  if (Number.isFinite(startIGT)) return Math.max(0, startIGT);
  for (const value of [match?.completedInGameTimestamp, match?.result?.inGameTimestamp]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return 0;
};

// ── Replay-based ghost modeling (primary path) ──────────────────────────
// Replay one of this player's real past-match traces, scaled to the new match
// duration. Recency-weighted random pick (0.7^i).
async function getPlayerMatchTraces(db, playerUUID, allMatches, viewerIGT = Infinity) {
  const boundary = Number(viewerIGT);
  const eligible = allMatches.filter((m) =>
    m.status === 'complete'
    && !m.result?.wasForfeited
    && (!Number.isFinite(boundary) || getCompletedMatchIGT(m) <= Math.max(0, boundary))
    && (m.teams || []).some((t) => Array.isArray(t) && t.some((p) => p?.UUID === playerUUID))
  );
  if (!eligible.length) return [];

  const tasks = Number.isFinite(boundary) && typeof db.getPlayerStoreThroughIGT === 'function'
    ? await db.getPlayerStoreThroughIGT(STORES.task, playerUUID, boundary)
    : await db.getPlayerStore(STORES.task, playerUUID);
  const scoreEvents = await db.getPlayerStore(STORES.matchScoreEvent, playerUUID).catch(() => []);
  const traces = [];
  for (const m of eligible) {
    const start = new Date(m.createdAt).getTime();
    if (!Number.isFinite(start)) continue;
    const durationMs = getMatchDurationHours(m) * HOUR;
    const end = start + durationMs;

    const sessions = (scoreEvents || [])
      .filter((event) => (
        String(event?.matchUUID || '') === String(m.UUID)
        && String(event?.participantUUID || '') === String(playerUUID)
      ))
      .map((event) => {
        const completed = new Date(event.occurredAt || event.createdAt || 0).getTime();
        const activeMs = Math.max(0, Number(event.evidence?.matchReward?.eligibleActiveMs) || 0);
        return {
          startOffset: Math.max(0, completed - activeMs - start),
          endOffset: Math.min(durationMs, Math.max(0, completed - start)),
          points: Math.max(0, Math.floor(Number(event.points) || 0)),
          name: event.evidence?.targetName || 'audited Match work',
        };
      })
      .filter((session) => session.points > 0 && session.endOffset >= 0 && session.endOffset <= durationMs);
    if (!sessions.length) {
      for (const t of tasks) {
        const created = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
        const completed = t.completedAt ? new Date(t.completedAt).getTime() : NaN;
        if (!Number.isFinite(created) || !Number.isFinite(completed)) continue;
        if (completed < start || completed > end) continue;
        sessions.push({
          startOffset: Math.max(0, created - start),
          endOffset: completed - start,
          points: getCanonicalTaskPoints(t),
          name: t.name || 'working',
        });
      }
    }
    if (!sessions.length) continue;
    sessions.sort((a, b) => a.startOffset - b.startOffset);
    traces.push({
      matchUUID: m.UUID, createdAt: m.createdAt, durationMs, sessions,
      totalPoints: sessions.reduce((s, x) => s + x.points, 0),
    });
  }
  traces.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return traces;
}

function selectReplayTrace(traces, seed, newDurationMs) {
  if (!traces.length) return null;
  const weights = traces.map((_, i) => 0.7 ** i);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = seededRandom(seed) * total;
  let idx = 0;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) { idx = i; break; }
  }
  const chosen = traces[idx];
  const scale = chosen.durationMs > 0 ? newDurationMs / chosen.durationMs : 1;
  return {
    sourceMatchUUID: chosen.matchUUID,
    durationMs: newDurationMs,
    totalPoints: Math.round(chosen.totalPoints),
    sessions: chosen.sessions.map((s) => ({
      startOffset: Math.round(s.startOffset * scale),
      endOffset: Math.round(s.endOffset * scale),
      points: s.points,
      name: s.name,
    })),
  };
}

// ── Rate-based fallback (only for players with no match history) ────────
function estimateGhostByRate(player, durationHours, completedTasks) {
  // Legacy histories without audited Match events retain the direct-work rate.
  // Elo and retired reward multipliers never manufacture a higher fallback.
  const BASE_RATE = 1 / 10000;
  const UTIL = 0.4;

  if (!completedTasks.length) {
    return {
      pointsPerMs: BASE_RATE,
      estimatedTotal: Math.max(60, Math.round(BASE_RATE * durationHours * HOUR * UTIL)),
      recentTaskNames: [],
    };
  }
  const totalDur = completedTasks.reduce((s, t) => s + getTaskDuration(t), 0);
  const totalPts = completedTasks.reduce((s, t) => s + getCanonicalTaskPoints(t), 0);
  const rawRate = totalDur > 0 ? totalPts / totalDur : BASE_RATE;
  const trust = Math.min(completedTasks.length / 10, 1);
  const observedRate = Math.max(0, Math.min(rawRate, BASE_RATE));
  const ppm = observedRate * trust + BASE_RATE * (1 - trust);
  return {
    pointsPerMs: ppm,
    estimatedTotal: Math.max(60, Math.round(ppm * durationHours * HOUR * UTIL)),
    recentTaskNames: completedTasks.filter((t) => t.name).map((t) => t.name).slice(0, 15),
  };
}

async function estimateGhostPower(db, player, durationHours, allMatches, viewerIGT = Infinity) {
  const newDurationMs = durationHours * HOUR;
  const baseFields = {
    playerTheme: player.activeCosmetics?.profileTheme || player.activeCosmetics?.appTheme || player.activeCosmetics?.theme || 'minimalist',
    profileTheme: player.activeCosmetics?.profileTheme || player.activeCosmetics?.appTheme || player.activeCosmetics?.theme || 'minimalist',
    avatarFrame: player.activeCosmetics?.avatarFrame || 'default',
    matchCard: player.activeCosmetics?.matchCard || 'default',
    standingsRow: player.activeCosmetics?.standingsRow || 'default',
    cardBanner: player.activeCosmetics?.cardBanner || null,
    isGenerated: false,
  };

  const traces = await getPlayerMatchTraces(db, player.UUID, allMatches, viewerIGT);
  if (traces.length) {
    const seed = hashString(`${player.UUID}-${Date.now()}-replay`);
    const replay = selectReplayTrace(traces, seed, newDurationMs);
    return {
      ...player, ...baseFields, replayTrace: replay,
      estimatedTotal: replay.totalPoints,
      pointsPerMs: replay.totalPoints / newDurationMs,
      recentTaskNames: replay.sessions.map((s) => s.name).slice(0, 15),
    };
  }

  const boundary = Number(viewerIGT);
  const tasks = Number.isFinite(boundary) && typeof db.getPlayerStoreThroughIGT === 'function'
    ? await db.getPlayerStoreThroughIGT(STORES.task, player.UUID, boundary)
    : await db.getPlayerStore(STORES.task, player.UUID);
  const completed = tasks
    .filter((t) => t.completedAt && t.createdAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, 30);
  return { ...player, ...baseFields, ...estimateGhostByRate(player, durationHours, completed) };
}

// Pair Match: current player + one teammate versus two opponents.
// Formation uses rating averages only; productivity estimates never influence
// matchmaking or team placement.
function chooseBalancedTeams(currentPlayer, ghosts) {
  const selected = ghosts.slice(0, 3);
  const myElo = Number(currentPlayer.elo || 1000);
  let best = null;
  for (let teammateIndex = 0; teammateIndex < selected.length; teammateIndex += 1) {
    const teammate = selected[teammateIndex];
    const opponents = selected.filter((_, index) => index !== teammateIndex);
    if (opponents.length !== 2) continue;
    const team1Average = (myElo + Number(teammate.elo || 1000)) / 2;
    const team2Average = opponents.reduce((sum, player) => sum + Number(player.elo || 1000), 0) / 2;
    const ratingGap = Math.abs(team1Average - team2Average);
    if (!best || ratingGap < best.ratingGap) {
      best = { team1: [teammate], team2: opponents, ratingGap };
    }
  }
  return best || { team1: selected.slice(0, 1), team2: selected.slice(1, 3), ratingGap: Infinity };
}

export async function buildGhostRoster(db, allPlayers, currentPlayer, durationHours, options = {}) {
  const viewerIGT = Number(options.viewerIGT);
  const myElo = Number(currentPlayer.elo || 1000);
  const candidates = allPlayers.filter((player) => (
    player.UUID !== currentPlayer.UUID
    && Math.abs(Number(player.elo || 1000) - myElo) <= PAIR_MATCH_RATING_RANGE
  ));
  const allMatches = Number.isFinite(viewerIGT) && typeof db.getCompletedMatchesThroughIGT === 'function'
    ? await db.getCompletedMatchesThroughIGT(viewerIGT)
    : await db.getAll(STORES.match);
  const rated = await Promise.all(
    candidates.map((p) => estimateGhostPower(db, p, durationHours, allMatches, viewerIGT))
  );

  rated.sort((a, b) => {
    const da = Math.abs((a.elo || 1000) - myElo);
    const db_ = Math.abs((b.elo || 1000) - myElo);
    return da !== db_ ? da - db_ : (b.estimatedTotal || 0) - (a.estimatedTotal || 0);
  });

  const selected = rated.slice(0, 3);

  // Synthetic "Echo" fillers are rank-gated. At Iron/Bronze, pad the fixed
  // four-player roster to three candidates. At Silver+,
  // we refuse to pad with synthetics — instead we surface an `insufficient`
  // signal up to the caller (Lobby), which shows InsufficientPlayersModal
  // and does NOT write a match record. Real candidates are still drawn from
  // the entire profile pool above; only the synthetic-filler path is gated.
  if (selected.length < 3) {
    if (!isEchoAllowed(currentPlayer.elo || 0)) {
      return { insufficient: true, available: selected.length };
    }
    while (selected.length < 3) {
      const i = selected.length;
      const seed = hashString(`${currentPlayer.UUID}-${currentPlayer.createdAt || ''}-${i}`);
      const variance = 0.82 + seededRandom(seed) * 0.38;
      const elo = Math.max(100, Math.round(myElo + (seededRandom(seed + 1) - 0.5) * 180));
      const est = Math.max(60, Math.round((myElo / 8) * durationHours * variance));
      selected.push({
        UUID: `ghost-${currentPlayer.UUID}-${i}`,
        username: `${currentPlayer.username || 'Agent'} Echo ${i + 1}`,
        profilePicture: null,
        elo,
        estimatedTotal: est,
        pointsPerMs: est / (durationHours * HOUR),
        isGenerated: true,
        generatedSeed: seed,
      });
    }
  }

  const balanced = chooseBalancedTeams(currentPlayer, selected);
  if (balanced.ratingGap > PAIR_MATCH_MAX_TEAM_RATING_GAP) {
    return {
      insufficient: true,
      available: selected.length,
      reason: 'team-rating-gap',
      ratingGap: balanced.ratingGap,
    };
  }
  return {
    teammates: balanced.team1,
    opponents: balanced.team2,
    insufficient: false,
    ratingGap: balanced.ratingGap,
  };
}

// ── Live scoring ────────────────────────────────────────────────────────
export function getGhostScore(player, createdAt, durationHours, now = Date.now()) {
  const elapsed = now - new Date(createdAt).getTime();

  if (player.replayTrace?.sessions) {
    let total = 0;
    for (const s of player.replayTrace.sessions) {
      if (s.endOffset <= elapsed) total += s.points;
    }
    return Math.round(total);
  }

  const ratio = Math.max(0, Math.min(1, elapsed / (durationHours * HOUR)));
  const seed = hashString(`${player.UUID}-${createdAt}`);
  const base = Number(player.estimatedTotal || 0);
  const progress = ratio ** (0.92 + seededRandom(seed) * 0.18);
  const vol = (seededRandom(seed + Math.min(Math.floor(ratio * 12), 11)) - 0.5) * 0.08;
  return Math.max(0, Math.round(base * Math.max(0, Math.min(1.05, progress + vol))));
}

export function getGhostActivity(ghost, elapsedRatio = 0) {
  const durationMs = ghost.replayTrace?.durationMs || HOUR;
  return getPlayerActivityState(ghost, {
    elapsedMs: elapsedRatio * durationMs,
    durationMs,
    isCurrentPlayer: false,
  }).label;
}

export function buildGhostScoresSync(match, currentPlayerUUID, now = Date.now()) {
  if (!match) return {};
  const next = {};
  const teams = getMatchTeams(match);
  const all = [...(teams?.[0] || []), ...(teams?.[1] || [])];
  for (const player of all) {
    if (!player?.UUID || String(player.UUID) === String(currentPlayerUUID)) continue;
    next[player.UUID] = getGhostScore(
      player,
      match.lockedAt || match.createdAt,
      getMatchDurationHours(match),
      now,
    );
  }
  return next;
}

// ── Snapshot hydration ──────────────────────────────────────────────────
// Match rosters/chat denormalize username+avatar at write-time. The data-only
// export strips those; we fall back to the live player store at render time
// so the UI self-heals when only one bundle was imported.
export function hydratePlayerSnapshot(snap, byUUID) {
  if (!snap?.UUID) return snap;
  const live = byUUID && byUUID[snap.UUID];
  if (!live) return snap;
  return {
    ...snap,
    username: snap.username || live.username,
    profilePicture: snap.profilePicture != null ? snap.profilePicture : (live.profilePicture ?? null),
  };
}

export function hydrateMatchTeams(match, byUUID) {
  if (!match) return match;
  if (match.participantSnapshot?.participants?.length) {
    return { ...match, teams: getMatchTeams(match) };
  }
  if (!Array.isArray(match.teams)) return match;
  return {
    ...match,
    teams: match.teams.map((t) => (t || []).map((p) => hydratePlayerSnapshot(p, byUUID))),
  };
}

export function getPlayerTeamIndex(match, playerUUID) {
  if (!match || !playerUUID) return null;
  const teams = getMatchTeams(match);
  const index = teams.findIndex((team) => (
    (team || []).some((player) => String(player?.UUID) === String(playerUUID))
  ));
  return index >= 0 ? index : null;
}

function finiteScore(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getMatchOutcomeForPlayer(match, playerUUID) {
  const result = match?.result || {};
  const playerTeamIdx = getPlayerTeamIndex(match, playerUUID);
  const opponentTeamIdx = playerTeamIdx == null
    ? null
    : playerTeamIdx === 0 ? 1 : 0;
  const storedTotals = result.highlights?.teamTotals || [];
  const teamScores = [
    finiteScore(result.team1Total, finiteScore(storedTotals[0])),
    finiteScore(result.team2Total, finiteScore(storedTotals[1])),
  ];
  const playerScore = playerTeamIdx == null ? null : teamScores[playerTeamIdx];
  const opponentScore = opponentTeamIdx == null ? null : teamScores[opponentTeamIdx];
  const margin = playerScore == null || opponentScore == null
    ? null
    : Math.abs(playerScore - opponentScore);

  const isLive = match?.status === 'active';
  let winnerTeamIdx = result.winner == null ? null : Number(result.winner) - 1;
  if (![0, 1].includes(winnerTeamIdx)) {
    winnerTeamIdx = teamScores.every((score) => score != null) && teamScores[0] !== teamScores[1]
      ? teamScores[0] > teamScores[1] ? 0 : 1
      : null;
  }

  let won = playerTeamIdx != null && winnerTeamIdx != null
    ? playerTeamIdx === winnerTeamIdx
    : null;
  if (won == null && !isLive && typeof result.iWon === 'boolean') {
    const ownerTeamIdx = getPlayerTeamIndex(match, match?.parent);
    if (playerTeamIdx != null && ownerTeamIdx != null) {
      won = playerTeamIdx === ownerTeamIdx ? result.iWon : !result.iWon;
    } else if (String(match?.parent) === String(playerUUID)) {
      won = result.iWon;
    }
  }

  const ownerTeamIdx = getPlayerTeamIndex(match, match?.parent);
  const explicitForfeitingTeamIdx = finiteScore(result.forfeitingTeamIdx);
  const forfeitingTeamIdx = result.wasForfeited
    ? [0, 1].includes(explicitForfeitingTeamIdx) ? explicitForfeitingTeamIdx : ownerTeamIdx
    : null;
  const forfeited = forfeitingTeamIdx != null && playerTeamIdx === forfeitingTeamIdx;
  if (forfeitingTeamIdx != null && playerTeamIdx != null) {
    won = playerTeamIdx !== forfeitingTeamIdx;
    winnerTeamIdx = forfeitingTeamIdx === 0 ? 1 : 0;
  }
  let status = 'pending';
  if (isLive) status = 'live';
  else if (forfeited) status = 'forfeit';
  else if (won === true) status = 'win';
  else if (won === false) status = 'loss';

  return {
    status,
    won: won === true,
    forfeited,
    wasForfeited: !!result.wasForfeited,
    playerTeamIdx,
    opponentTeamIdx,
    winnerTeamIdx,
    forfeitingTeamIdx,
    playerScore,
    opponentScore,
    margin,
  };
}
