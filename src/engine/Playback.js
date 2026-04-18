/**
 * Ghost playback window sampling.
 *
 * Mode-agnostic — any mode that wants "replay a real player's historical task
 * stream as a ghost's income" uses this exact system. The output is a
 * GhostPlaybackWindow: a sorted, read-only schedule of
 * { completionOffsetMs, storedPoints } entries plus a cursor for the next
 * unfired entry.
 *
 * The arena's tick loop calls `advanceCursor(window, matchElapsedMs)` on each
 * clock tick. Any entries whose offset has been crossed are unlocked — their
 * `storedPoints` are added to the ghost's spendable budget, and the cursor is
 * advanced. Schedule itself is never mutated after Loading.
 */

import { HOUR, STORES } from '../utils/Constants.js';

const TWO_HOURS_MS = 2 * HOUR;

/**
 * Sample a single ghost's 2-hour playback window.
 *
 * Algorithm (spec §3.1):
 *   1. Query all completed match records for this ghost whose duration ≥ 2h.
 *   2. If none exist, return a synthetic tiny schedule.
 *   3. Pick one source match uniformly. Compute its time window.
 *   4. Pick a random offset into that window, take a 2-hour slice.
 *   5. Collect all tasks the ghost completed inside the slice; build schedule
 *      entries keyed by `completionOffsetMs` from the slice start.
 *
 * `rng` is a seeded [0,1) function so sampling is reproducible per match.
 */
export async function sampleGhostPlaybackWindow(databaseConnection, ghost, rng, spanMs = TWO_HOURS_MS) {
  if (!ghost?.UUID) {
    return synthWindow(ghost, rng || Math.random, spanMs);
  }
  const roll = rng || Math.random;

  let matches = [];
  try {
    matches = await databaseConnection.getPlayerStore(STORES.match, ghost.UUID);
  } catch {
    return synthWindow(ghost, roll, spanMs);
  }

  const candidates = (matches || []).filter((m) => {
    if (!m?.result || !m.createdAt) return false;
    const endedAt = m.result?.endedAt ? Date.parse(m.result.endedAt) : null;
    const startedAt = Date.parse(m.createdAt);
    const fallbackEnd = startedAt + Number(m.duration || 0) * HOUR;
    const end = Number.isFinite(endedAt) ? endedAt : fallbackEnd;
    return Number.isFinite(startedAt) && end - startedAt >= spanMs;
  });

  if (candidates.length === 0) {
    return synthWindow(ghost, roll, spanMs);
  }

  const source = candidates[Math.floor(roll() * candidates.length)];
  const sourceStart = Date.parse(source.createdAt);
  const sourceEnd = source.result?.endedAt
    ? Date.parse(source.result.endedAt)
    : sourceStart + Number(source.duration || 0) * HOUR;
  const windowSpan = sourceEnd - sourceStart;
  const maxOffset = Math.max(0, windowSpan - spanMs);
  const sliceOffset = Math.floor(roll() * (maxOffset + 1));
  const sliceStart = sourceStart + sliceOffset;
  const sliceEnd = sliceStart + spanMs;

  let tasks = [];
  try {
    tasks = await databaseConnection.getPlayerStore(STORES.task, ghost.UUID);
  } catch {
    tasks = [];
  }

  const schedule = [];
  for (const task of tasks || []) {
    const completedAt = task?.completedAt ? Date.parse(task.completedAt) : null;
    if (!Number.isFinite(completedAt)) continue;
    if (completedAt < sliceStart || completedAt >= sliceEnd) continue;
    const points = Number(task.points);
    if (!Number.isFinite(points) || points <= 0) continue;
    schedule.push({
      taskUUID: task.UUID,
      completedAtUtc: new Date(completedAt).toISOString(),
      completionOffsetMs: completedAt - sliceStart,
      storedPoints: Math.round(points),
    });
  }

  schedule.sort((a, b) => a.completionOffsetMs - b.completionOffsetMs);

  if (schedule.length === 0) {
    return synthWindow(ghost, roll, spanMs);
  }

  // ── Cadence correction ────────────────────────────────────────────
  // Real task histories are sparse — most players complete 4–8 tasks in a
  // 2-hour window, leaving 20–30 minute stretches with no scheduled unlocks.
  // In a tactical mode that cadence reads as "ghosts standing still."
  // Insert small filler entries so no gap exceeds FILLER_GAP_MS, preserving
  // the real activity pattern while keeping ghosts visibly active.
  // Filler points are small enough (~1 defender move + 1 attack) to avoid
  // meaningfully inflating the ghost's economy.
  const withFillers = insertFillerEntries(
    schedule,
    spanMs,
    new Date(sliceStart).toISOString(),
  );

  return {
    sourceMatchUUID: source.UUID,
    sourceMatchStartedAtUtc: new Date(sourceStart).toISOString(),
    sourceMatchEndedAtUtc: new Date(sourceEnd).toISOString(),
    sampledWindowStartedAtUtc: new Date(sliceStart).toISOString(),
    sampledWindowEndedAtUtc: new Date(sliceEnd).toISOString(),
    schedule: withFillers,
    nextCompletionCursor: 0,
    synthetic: false,
  };
}

// ── Cadence correction ────────────────────────────────────────────

/**
 * Gap cap between consecutive schedule entries. A 90-second ceiling keeps
 * ghosts visibly active — roughly one filler between real task unlocks on
 * typical histories. Tuning-wise, this trades "real history fidelity" for
 * "ghosts feel alive"; in a tactical mode the latter wins.
 */
const FILLER_GAP_MS = 90_000;

/**
 * Points granted by a filler entry. Enough for ~12 defender moves (cost 2)
 * or ~8 attacker moves (cost 3), or a single attack+move combo. Not enough
 * to plant/defuse (cost 30) outright, which preserves the economic weight
 * of real task unlocks.
 */
const FILLER_POINTS = 25;

/**
 * Take a real-history schedule and pad gaps larger than FILLER_GAP_MS with
 * synthetic filler entries. Also ensures the first entry lands within
 * FILLER_GAP_MS of match start (so ghosts don't freeze the opening minute)
 * and that the tail of the window isn't silent.
 *
 * Pure.
 */
function insertFillerEntries(schedule, spanMs, windowStartIso) {
  if (!Array.isArray(schedule) || schedule.length === 0) return schedule;
  const out = [];
  let prevOffset = 0;
  let fillerIdx = 0;
  const addFiller = (offset) => {
    fillerIdx += 1;
    out.push({
      taskUUID: `filler-${fillerIdx}-at-${offset}`,
      completedAtUtc: windowStartIso,
      completionOffsetMs: offset,
      storedPoints: FILLER_POINTS,
      isFiller: true,
    });
  };
  for (const entry of schedule) {
    while (entry.completionOffsetMs - prevOffset > FILLER_GAP_MS) {
      prevOffset += FILLER_GAP_MS;
      addFiller(prevOffset);
    }
    out.push(entry);
    prevOffset = entry.completionOffsetMs;
  }
  // Tail-pad up to spanMs — 83% cap matches synth's trailing-silence
  // convention so attackers/defenders spend in the closing stretch
  // rather than earning new points.
  const tailCap = Math.floor(spanMs * 0.83);
  while (prevOffset < tailCap - FILLER_GAP_MS) {
    prevOffset += FILLER_GAP_MS;
    addFiller(prevOffset);
  }
  return out;
}

/**
 * Synthetic fallback schedule for ghosts with insufficient history.
 * Produces a denser, earlier schedule over the window so synthetic ghosts
 * start acting within the first minute rather than appearing frozen for
 * 10+ minutes (issue #7). Shape mirrors a real playback window so all
 * downstream code is uniform.
 *
 * @param {object} ghost  the player record we're synthesizing for.
 * @param {() => number} rng  [0,1) seeded RNG.
 * @param {number} [spanMs]  total window duration; defaults to 2h. Scales
 *   with match duration in time-compressed test modes.
 */
function synthWindow(ghost, rng, spanMs = TWO_HOURS_MS) {
  // FIX (issue #7): the previous schedule of 6–9 entries spread evenly over
  // the 2-hour window put the first entry at offset `(0.5 / 6) * TWO_HOURS`
  // ≈ 10 minutes. Every synthetic ghost (which is most of them, for players
  // without 2h+ of match history) stayed silent that whole first 10 minutes.
  // New layout: 14–18 entries, the first one firing between 30s and 60s in,
  // the last one at ~83% of the window (leaving the closing stretch for
  // spending, not earning).
  const entryCount = 14 + Math.floor(rng() * 5);           // 14–18 entries
  const pointsPer = 50 + Math.floor(rng() * 30);           // 50–79 points each
  const now = Date.now();
  const firstOffsetMs = 30_000 + Math.floor(rng() * 30_000);          // 30–60s
  const lastOffsetMs = Math.max(firstOffsetMs + 1000, Math.floor(spanMs * 0.83));

  const schedule = Array.from({ length: entryCount }, (_, i) => {
    const t = entryCount === 1 ? 0 : i / (entryCount - 1);
    const offset = Math.floor(firstOffsetMs + t * (lastOffsetMs - firstOffsetMs));
    return {
      taskUUID: `synth-${ghost?.UUID || 'anon'}-${i}`,
      completedAtUtc: new Date(now + offset).toISOString(),
      completionOffsetMs: offset,
      storedPoints: pointsPer,
    };
  });

  return {
    sourceMatchUUID: null,
    sourceMatchStartedAtUtc: null,
    sourceMatchEndedAtUtc: null,
    sampledWindowStartedAtUtc: null,
    sampledWindowEndedAtUtc: null,
    schedule,
    nextCompletionCursor: 0,
    synthetic: true,
  };
}

/**
 * Pure cursor advance. Given a playback window and the current matchElapsedMs,
 * returns:
 *   {
 *     unlocked: Array<{ taskUUID, completionOffsetMs, storedPoints }>,
 *     nextCursor: number,
 *     pointsUnlocked: number,
 *   }
 *
 * Called once per ghost per tick. Callers apply `pointsUnlocked` to the
 * ghost's budget and persist `nextCursor` back into the match record.
 */
export function advanceCursor(window, matchElapsedMs) {
  if (!window || !Array.isArray(window.schedule)) {
    return { unlocked: [], nextCursor: 0, pointsUnlocked: 0 };
  }
  const schedule = window.schedule;
  const start = window.nextCompletionCursor ?? 0;
  let cursor = start;
  const unlocked = [];
  let pointsUnlocked = 0;

  while (cursor < schedule.length && schedule[cursor].completionOffsetMs <= matchElapsedMs) {
    unlocked.push(schedule[cursor]);
    pointsUnlocked += schedule[cursor].storedPoints;
    cursor += 1;
  }

  return { unlocked, nextCursor: cursor, pointsUnlocked };
}