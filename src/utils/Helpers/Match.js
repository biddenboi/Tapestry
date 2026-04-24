import { HOUR, STORES } from '../Constants.js';
import { getTaskDuration } from './Tasks.js';

// ──────────────────────────────────────────────────────────────────────────
// Math utilities (unchanged)
// ──────────────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value = '') {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Fallback activity names for synthetic ghosts or players with no task history.
const GHOST_ACTIVITIES = [
  'doing calculus', 'debugging code', 'reading research', 'writing an essay',
  'reviewing lecture notes', 'solving equations', 'practicing algorithms',
  'studying biology', 'writing documentation', 'working on a project',
  'grinding problem sets', 'learning German', 'reading a textbook', 'doing physics',
  'coding a new feature', 'studying history', 'writing a report', 'prepping for exam',
  'practicing piano', 'doing chemistry labs', 'reading philosophy', 'language drills',
  'working through proofs', 'studying anatomy', 'drafting architecture designs',
  'working on linear algebra', 'reading case studies', 'memorizing flashcards',
];

// ──────────────────────────────────────────────────────────────────────────
// Replay-based ghost modeling (primary path)
//
// A ghost's best prediction of "what would this player do in a match" is
// simply what they did in a past match. We pull their real task-level trace
// from any completed, non-forfeited match they participated in, and replay
// that trace onto the new match timeline.
//
// Advantages over rate-based estimation:
//   • Total magnitudes match reality (no multiplier calibration needed).
//   • Score curve is bursty — points land at real session completions,
//     not a smooth continuous curve.
//   • Variance across different ghost instances is real variance — we sample
//     from the player's actual distribution of past-match performances.
//   • Activity names are real task names from the replayed session.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull all replayable past-match traces for a given player.
 *
 *   - Match must be status=complete and not forfeited.
 *   - Player must appear in one of the teams.
 *   - At least one of the player's completed tasks must fall inside the
 *     match's time window.
 *
 * Sessions that started *before* match start but completed within it have
 * their startOffset clipped to 0 (handles the rare straddle-at-boundary).
 * Sessions that started inside but completed after the window are excluded
 * by the window filter — they simply aren't part of the player's score
 * contribution for that match.
 *
 * Returns traces sorted most-recent first.
 */
async function getPlayerMatchTraces(databaseConnection, playerUUID, allMatches) {
  const eligible = allMatches.filter((m) => {
    if (m.status !== 'complete') return false;
    if (m.result?.wasForfeited) return false;
    const teams = m.teams || [];
    return teams.some((team) =>
      Array.isArray(team) && team.some((p) => p?.UUID === playerUUID)
    );
  });

  if (eligible.length === 0) return [];

  const playerTasks = await databaseConnection.getPlayerStore(STORES.task, playerUUID);

  const traces = [];
  for (const m of eligible) {
    const start = new Date(m.createdAt).getTime();
    if (!Number.isFinite(start)) continue;
    const durationMs = Number(m.duration || 0) * HOUR;
    const end = start + durationMs;

    const sessions = [];
    for (const t of playerTasks) {
      const createdMs   = t.createdAt   ? new Date(t.createdAt).getTime()   : NaN;
      const completedMs = t.completedAt ? new Date(t.completedAt).getTime() : NaN;
      if (!Number.isFinite(createdMs) || !Number.isFinite(completedMs)) continue;
      // Window filter on completion — task must have been finished inside the match.
      if (completedMs < start || completedMs > end) continue;

      sessions.push({
        // Clip session starts to the match boundary (a session begun moments
        // before match start is still effectively a match session).
        startOffset: Math.max(0, createdMs - start),
        endOffset:   completedMs - start,
        points:      Number(t.points || 0),
        name:        t.name || 'working',
      });
    }

    if (sessions.length === 0) continue;

    sessions.sort((a, b) => a.startOffset - b.startOffset);
    const totalPoints = sessions.reduce((s, x) => s + x.points, 0);

    traces.push({
      matchUUID: m.UUID,
      createdAt: m.createdAt,
      durationMs,
      sessions,
      totalPoints,
    });
  }

  traces.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return traces;
}

/**
 * Deterministically pick one trace (recency-weighted) and scale it onto the
 * new match's duration.
 *
 *   weight[i] = 0.7^i  (i=0 is most recent)
 *
 * This makes recent form most likely to be drawn, while still giving older
 * matches a real chance — so the ghost distribution reflects the player's
 * full range of performances, not just their latest session.
 *
 * The scale factor maps a past match's timeline onto the new match's
 * timeline. Matches are constrained to [2, 4] hours so the scale factor is
 * bounded to [0.5, 2.0] — no pathological stretching.
 */
function selectReplayTrace(traces, seed, newDurationMs) {
  if (!traces.length) return null;

  const weights = traces.map((_, i) => Math.pow(0.7, i));
  const totalW  = weights.reduce((s, w) => s + w, 0);
  let roll = seededRandom(seed) * totalW;
  let idx  = 0;
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
      endOffset:   Math.round(s.endOffset   * scale),
      points:      s.points,
      name:        s.name,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Legacy rate-based fallback (for players with no match history)
//
// Kept ~intact from the pre-replay implementation. Imperfect, but it's the
// only option for players who've never played a match before. As match
// history accumulates for any given player, the replay path takes over
// automatically.
// ──────────────────────────────────────────────────────────────────────────

function estimateGhostByRate(player, durationHours, completedTasks) {
  const MAX_RATE = (1.8 * 7.0 * 2.5) / 10000;
  const eloFallbackRate = (Math.max(100, player.elo || 900) / 1000) * (1.0 / 10000);
  const UTILIZATION = 0.4;

  if (completedTasks.length === 0) {
    const expectedTotal = Math.round(eloFallbackRate * durationHours * HOUR * UTILIZATION);
    return {
      pointsPerMs: eloFallbackRate,
      estimatedTotal: Math.max(60, expectedTotal),
      recentTaskNames: [],
    };
  }

  const totalDuration = completedTasks.reduce((sum, task) => sum + getTaskDuration(task), 0);
  const totalPoints   = completedTasks.reduce((sum, task) => sum + Number(task.points || 0), 0);
  const rawRate    = totalDuration > 0 ? totalPoints / totalDuration : eloFallbackRate;
  const actualRate = Math.min(rawRate, MAX_RATE);

  const TRUST_THRESHOLD = 10;
  const trustWeight = Math.min(completedTasks.length / TRUST_THRESHOLD, 1.0);
  const pointsPerMs = actualRate * trustWeight + eloFallbackRate * (1 - trustWeight);

  const expectedTotal = Math.round(pointsPerMs * durationHours * HOUR * UTILIZATION);
  return {
    pointsPerMs,
    estimatedTotal: Math.max(60, expectedTotal),
    recentTaskNames: completedTasks.filter((t) => t.name).map((t) => t.name).slice(0, 15),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Ghost construction — runs once at match creation time.
//
// Primary path: if the player has any replayable match traces, pick one
// (recency-weighted), scale it to the new match duration, and stamp the
// result on the ghost object. Everything else derives from that trace.
//
// Fallback path: no match history → rate-based estimation (legacy).
// ──────────────────────────────────────────────────────────────────────────

async function estimateGhostPower(databaseConnection, player, durationHours, allMatches) {
  const newDurationMs = durationHours * HOUR;

  // ── Primary: replay-based ───────────────────────────────────────────
  const traces = await getPlayerMatchTraces(databaseConnection, player.UUID, allMatches);
  if (traces.length > 0) {
    // Deterministic per-ghost-per-match pick. Date.now() differentiates
    // ghost rolls across back-to-back match creations; ghost UUID
    // differentiates ghosts within a single match.
    const seed = hashString(`${player.UUID}-${Date.now()}-replay`);
    const replayTrace = selectReplayTrace(traces, seed, newDurationMs);

    return {
      ...player,
      replayTrace,
      estimatedTotal: replayTrace.totalPoints,
      pointsPerMs: replayTrace.totalPoints / newDurationMs,
      isGenerated: false,
      traceSource: 'replay',
      recentTaskNames: replayTrace.sessions.map((s) => s.name).slice(0, 15),
      playerTheme: player.activeCosmetics?.theme || 'default',
      cardBanner: player.activeCosmetics?.cardBanner || null,
    };
  }

  // ── Fallback: rate-based ────────────────────────────────────────────
  const tasks = await databaseConnection.getPlayerStore(STORES.task, player.UUID);
  const completed = tasks
    .filter((task) => task.completedAt && task.createdAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, 30);

  const fallback = estimateGhostByRate(player, durationHours, completed);
  return {
    ...player,
    ...fallback,
    isGenerated: false,
    traceSource: 'rate',
    playerTheme: player.activeCosmetics?.theme || 'default',
    cardBanner: player.activeCosmetics?.cardBanner || null,
  };
}

function synthGhost(currentPlayer, durationHours, index) {
  const seed = hashString(`${currentPlayer.UUID}-${currentPlayer.createdAt || ''}-${index}`);
  const variance = 0.82 + seededRandom(seed) * 0.38;
  const elo = Math.max(100, Math.round((currentPlayer.elo || 1000) + (seededRandom(seed + 1) - 0.5) * 180));
  const estimatedTotal = Math.max(60, Math.round(((currentPlayer.elo || 1000) / 8) * durationHours * variance));
  return {
    UUID: `ghost-${currentPlayer.UUID}-${index}`,
    username: `${currentPlayer.username || 'Agent'} Echo ${index + 1}`,
    profilePicture: null,
    elo,
    estimatedTotal,
    pointsPerMs: estimatedTotal / (durationHours * HOUR),
    isGenerated: true,
    traceSource: 'synth',
    generatedSeed: seed,
  };
}

function chooseBalancedTeams(currentPlayer, ghosts) {
  let best = null;
  const scoredGhosts = ghosts.map((ghost) => ({
    ...ghost,
    matchPower: (ghost.elo || 1000) + (ghost.estimatedTotal || 0) * 0.55,
  }));

  for (let i = 0; i < scoredGhosts.length; i += 1) {
    for (let j = i + 1; j < scoredGhosts.length; j += 1) {
      const team1 = [scoredGhosts[i], scoredGhosts[j]];
      const team2 = scoredGhosts.filter((_, idx) => idx !== i && idx !== j);
      if (team2.length !== 3) continue;

      const team1Power = team1.reduce((sum, g) => sum + g.matchPower, (currentPlayer.elo || 1000) + 220);
      const team2Power = team2.reduce((sum, g) => sum + g.matchPower, 0);
      const diff = Math.abs(team1Power - team2Power);

      if (!best || diff < best.diff) {
        best = { team1, team2, diff };
      }
    }
  }

  return best || { team1: scoredGhosts.slice(0, 2), team2: scoredGhosts.slice(2, 5), diff: Infinity };
}

export async function buildGhostRoster(databaseConnection, allPlayers, currentPlayer, durationHours) {
  const candidates = allPlayers.filter((player) => player.UUID !== currentPlayer.UUID);

  // Pre-fetch match store once and reuse for every candidate.
  const allMatches = await databaseConnection.getAll(STORES.match);

  const rated = await Promise.all(
    candidates.map((player) => estimateGhostPower(databaseConnection, player, durationHours, allMatches))
  );

  rated.sort((a, b) => {
    const eloDistanceA = Math.abs((a.elo || 1000) - (currentPlayer.elo || 1000));
    const eloDistanceB = Math.abs((b.elo || 1000) - (currentPlayer.elo || 1000));
    if (eloDistanceA !== eloDistanceB) return eloDistanceA - eloDistanceB;
    return (b.estimatedTotal || 0) - (a.estimatedTotal || 0);
  });

  const selected = rated.slice(0, 5);
  while (selected.length < 5) {
    selected.push(synthGhost(currentPlayer, durationHours, selected.length));
  }

  const { team1, team2, diff } = chooseBalancedTeams(currentPlayer, selected);
  return {
    teammates: team1,
    opponents: team2,
    diagnostics: {
      poolSize: candidates.length,
      selectedSize: selected.length,
      balanceDelta: Math.round(diff),
      synthesizedGhosts: selected.filter((g) => g.isGenerated).length,
      replayGhosts:     selected.filter((g) => g.traceSource === 'replay').length,
      rateGhosts:       selected.filter((g) => g.traceSource === 'rate').length,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Live scoring (called every render tick)
// ──────────────────────────────────────────────────────────────────────────

export function getGhostScore(player, createdAt, durationHours) {
  const matchStart = new Date(createdAt).getTime();
  const elapsedMs  = Date.now() - matchStart;

  // ── Primary: replay ─────────────────────────────────────────────────
  if (player.replayTrace?.sessions) {
    let total = 0;
    for (const s of player.replayTrace.sessions) {
      if (s.endOffset <= elapsedMs) total += s.points;
      // sessions are sorted by startOffset, so we can't early-break on end,
      // but in practice session counts are tiny (≤ ~10).
    }
    return Math.round(total);
  }

  // ── Fallback: smooth rate-based curve (legacy) ──────────────────────
  const elapsedRatio = clamp(elapsedMs / (durationHours * HOUR), 0, 1);
  const seed = hashString(`${player.UUID}-${createdAt}`);
  const base = Number(player.estimatedTotal || 0);
  const progress = Math.pow(elapsedRatio, 0.92 + seededRandom(seed) * 0.18);
  const volatilityIdx = Math.min(Math.floor(elapsedRatio * 12), 11);
  const volatility = (seededRandom(seed + volatilityIdx) - 0.5) * 0.08;
  const scaled = base * clamp(progress + volatility, 0, 1.05);
  return Math.max(0, Math.round(scaled));
}

/**
 * Current activity displayed for a ghost. For replay-based ghosts, returns
 * the name of whichever session is "running" at the current elapsed time
 * (or the most recently completed if none is running).
 */
export function getGhostActivity(ghost, elapsedRatio = 0) {
  // ── Primary: replay ─────────────────────────────────────────────────
  if (ghost.replayTrace?.sessions?.length) {
    const durationMs = ghost.replayTrace.durationMs || 0;
    const elapsed = elapsedRatio * durationMs;

    // Currently running
    for (const s of ghost.replayTrace.sessions) {
      if (s.startOffset <= elapsed && elapsed < s.endOffset) return s.name;
    }
    // Last completed before now (walk the sorted list)
    let last = null;
    for (const s of ghost.replayTrace.sessions) {
      if (s.endOffset <= elapsed) last = s.name;
      else break;
    }
    return last || 'warming up';
  }

  // ── Fallback: hashed window through generic labels / recent task names ──
  const windowIndex = Math.floor(clamp(elapsedRatio, 0, 0.999) * 10);
  const seed = hashString(`${ghost.UUID}-act-${windowIndex}`);
  if (ghost.recentTaskNames && ghost.recentTaskNames.length > 0) {
    return ghost.recentTaskNames[seed % ghost.recentTaskNames.length];
  }
  return GHOST_ACTIVITIES[seed % GHOST_ACTIVITIES.length];
}

// ──────────────────────────────────────────────────────────────────────────
// Snapshot hydration
//
// Match rosters and chat messages denormalize `username` and `profilePicture`
// onto each record at write-time. The profile/data export split strips those
// fields out of the data file (they go into the profile patch file instead).
// If a user imports data without the matching profile file, the snapshots are
// missing and the UI would show "Unknown" / blank avatars.
//
// These helpers fall back to the live `player` store whenever a snapshot is
// missing its identity fields, so the UI self-heals even if the profile
// patches were never reapplied. Truthy snapshot values always win — this
// preserves historical snapshots (e.g., a player's name at match time).
// ──────────────────────────────────────────────────────────────────────────

export function hydratePlayerSnapshot(snapshot, playersByUUID) {
  if (!snapshot || !snapshot.UUID) return snapshot;
  const live = playersByUUID && playersByUUID[snapshot.UUID];
  if (!live) return snapshot;
  return {
    ...snapshot,
    username: snapshot.username || live.username,
    profilePicture: snapshot.profilePicture != null
      ? snapshot.profilePicture
      : (live.profilePicture ?? null),
  };
}

export function hydrateMatchTeams(match, playersByUUID) {
  if (!match || !Array.isArray(match.teams)) return match;
  return {
    ...match,
    teams: match.teams.map((team) =>
      (team || []).map((player) => hydratePlayerSnapshot(player, playersByUUID))
    ),
  };
}