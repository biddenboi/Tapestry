import { DAY, HOUR, MINUTE } from '../Constants.js';
import { getLocalDate } from './Time.js';

export const getTaskDuration = (task) => {
  if (!task?.createdAt || !task?.completedAt) return 0;
  return Math.max(0, new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime());
};

export const getDaysUntilDue = (todo) => {
  if (!todo?.dueDate) return 1;
  const today = getLocalDate(new Date()).getTime();
  const due = getLocalDate(new Date(todo.dueDate)).getTime();
  return Math.max(1, Math.ceil((due - today) / DAY));
};

export const getTodoWPD = (todo) => {
  if (!todo) return 1;
  const estimated = Math.max(1, Number(todo.estimatedDuration) || 1);
  return estimated / getDaysUntilDue(todo);
};

export const getAllWPDFromArray = (data = []) => data.map((t) => getTodoWPD(t));

/**
 * getSlopes — returns displaySlope^1.5 for each todo, normalised to 0-100
 * percentages. Used for:
 *   - Item colour intensity in the todo list
 *   - Weighted-random selection in the stochastic branch of getNextTodo
 *
 * Accepts an optional `context` (see buildSlopeContext). When provided, the
 * full comprehensive slope is used; otherwise we fall back to the classical
 * two-factor slope (aversion × urgency).
 *
 * ^1.5 keeps lower-priority tasks meaningfully accessible; ^2 was too aggressive.
 */
export const getSlopes = (todoArray = [], context = null) => {
  if (!todoArray.length) return [];
  const raw = todoArray.map((t) => Math.pow(Math.max(0, getDisplaySlope(t, context)), 1.5));
  const total = raw.reduce((s, w) => s + w, 0);
  if (total === 0) return todoArray.map(() => 100 / todoArray.length);
  return raw.map((w) => (w / total) * 100);
};

/**
 * getWeights — kept for any existing callers outside this module.
 * @deprecated Use getSlopes instead.
 */
export const getWeights = (todoArray = [], context = null) => getSlopes(todoArray, context);

/**
 * getNextTodo — two-branch selection algorithm.
 *
 * Overdue branch (any task past its due date):
 *   Collect all overdue tasks, sort descending by displaySlope, return the highest.
 *
 * Stochastic branch (no overdue tasks):
 *   Use slope^1.5 as selection weights — biased toward high-priority tasks but
 *   not monopolised by them.
 *
 * The legacy signature accepted a `weights` array as the second arg. We now
 * use the second arg as an optional slope-evaluation context (object, not
 * array); a stray array is ignored and falls back to two-factor slope.
 */
export const getNextTodo = (todoArray = [], contextOrLegacy = null) => {
  if (!todoArray.length) return null;
  const context = (contextOrLegacy && !Array.isArray(contextOrLegacy)) ? contextOrLegacy : null;

  // ── Overdue branch ──────────────────────────────────────────────────────
  const today = getLocalDate(new Date());
  const overdue = todoArray.filter(
    (t) => t.dueDate && new Date(t.dueDate).getTime() < today.getTime(),
  );
  if (overdue.length > 0) {
    return [...overdue].sort(
      (a, b) => getDisplaySlope(b, context) - getDisplaySlope(a, context),
    )[0];
  }

  // ── Stochastic branch ───────────────────────────────────────────────────
  const weights = todoArray.map(
    (t) => Math.pow(Math.max(0, getDisplaySlope(t, context)), 1.5),
  );
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return todoArray[0];

  const roll = Math.random() * total;
  let cumulative = 0;
  for (let i = 0; i < todoArray.length; i += 1) {
    cumulative += weights[i];
    if (cumulative >= roll) return todoArray[i];
  }
  return todoArray[todoArray.length - 1];
};

export const getSessionMultiplier = (duration, estimatedDuration) => {
  if (estimatedDuration <= 0 || estimatedDuration == null) return 0;
  // exp(-Δ²/σ²) with σ = estimatedDuration. Peaks at 1.0 when duration = estimate.
  const delta = duration - estimatedDuration;
  return Math.exp(-(delta * delta) / (estimatedDuration * estimatedDuration));
};

export const getGaussianCurvePoints = (estimatedDurationMs, count = 240) => {
  if (!estimatedDurationMs || estimatedDurationMs <= 0) return [{ x: 0, y: 0 }];
  const maxX = estimatedDurationMs * 2.4;
  return Array.from({ length: count + 1 }, (_, index) => {
    const x = (index / count) * maxX;
    return { x, y: getSessionMultiplier(x, estimatedDurationMs) };
  });
};

export const sessionDurationToMs = (minutes) => Math.max(0, Number(minutes || 0)) * MINUTE;

// ---------------------------------------------------------------------------
// Aversion coercion
// ---------------------------------------------------------------------------

/**
 * Coerce a raw aversion value to a valid integer in {1, 2, 3}. Existing todos
 * with no aversion field map to 1 (the minimum).
 */
export const coerceAversion = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 3) return 3;
  return Math.round(n);
};

// ---------------------------------------------------------------------------
// Core multiplier components — used by BOTH points (via getTaskMultiplier)
// and the slope (via getDisplaySlope).
// ---------------------------------------------------------------------------

/** aversionWeight: 1.0 / 1.4 / 1.8 for aversion 1 / 2 / 3. */
export const getAversionWeight = (todo) => {
  const aversion = coerceAversion(todo?.aversion);
  return 0.6 + 0.4 * aversion;
};

/**
 * urgencyWeight — refined:
 *   no due date  → staleness-based, grows gently with days on list
 *                  0d → 0.5, 7d → 1.0, 30d → ~1.6, 90d → ~2.2
 *   not overdue  → smooth inverse falloff (no 4-day shelf)
 *                  due today → 4.0 (capped), 1d → 3.2, 4d → 0.94, 14d → 0.5 (floor)
 *   overdue      → min(4 + 0.3 × |daysOverdue|, 7)
 *
 * Returns a value in [0.5, 7.0]. Same bounds as before; smoother inside.
 * The 4.0 cap on the non-overdue branch matches the start of the overdue
 * ramp, keeping the curve continuous across the boundary.
 */
export const getUrgencyWeight = (todo, now = Date.now()) => {
  if (!todo?.dueDate) {
    // Staleness proxy — tasks without due dates gain pressure as they age.
    if (!todo?.createdAt) return 0.5;
    const daysOnList = Math.max(0, (now - new Date(todo.createdAt).getTime()) / DAY);
    return 0.5 + 0.5 * Math.log2(1 + daysOnList / 7);
  }
  const today = getLocalDate(new Date(now)).getTime();
  const due = getLocalDate(new Date(todo.dueDate)).getTime();
  const rawDays = (due - today) / DAY;
  if (rawDays >= 0) {
    return Math.min(4.0, Math.max(0.5, 4.0 / (rawDays + 0.25)));
  }
  return Math.min(7.0, 4.0 + 0.3 * Math.abs(rawDays));
};

/**
 * commitmentWeight:
 *   anchored at 15 min = 1.0×, 60 min = 2.0×, 120 min = 2.5×.
 *   Only awarded when actualMs >= committedMs; otherwise flat 1.0.
 */
export const getCommitmentWeight = (committedMs, actualMs) => {
  if (!committedMs || committedMs <= 0) return 1.0;
  const committedMinutes = committedMs / MINUTE;
  const raw = 1.0 + 0.5 * Math.log2(committedMinutes / 15);
  return actualMs >= committedMs ? Math.max(1.0, raw) : 1.0;
};

/**
 * Full task multiplier used for POINTS (competitions / leaderboard).
 * Stays intentionally simple: aversion × urgency × commitment.
 *
 * The richer slope factors (size, saturation, momentum, procrastination) are
 * *selection-only* signals; they don't inflate points so that a user can't
 * be punished in the point economy for e.g. working on their main project.
 */
export const getTaskMultiplier = (todo, committedMs, actualMs) =>
  getAversionWeight(todo) * getUrgencyWeight(todo) * getCommitmentWeight(committedMs, actualMs);

// ---------------------------------------------------------------------------
// Context builder — scans history once per list render so per-item slope
// evaluation is cheap.
// ---------------------------------------------------------------------------

/**
 * Build a slope-evaluation context from the user's completed task history.
 *
 * @param {Array} completedTasks — all of this player's past tasks. Only tasks
 *                                 with a completedAt timestamp are considered.
 * @returns {Object} context — pass to getDisplaySlope / getSlopes / getNextTodo.
 *   { now, projectShares, recentCount, mostRecent, mostRecentAge }
 */
export const buildSlopeContext = (completedTasks = []) => {
  const now = Date.now();
  const RECENT_WINDOW = 3 * DAY;
  const cutoff = now - RECENT_WINDOW;

  const recent = [];
  for (const t of completedTasks) {
    if (!t?.completedAt) continue;
    const ts = new Date(t.completedAt).getTime();
    if (ts > cutoff) recent.push({ ...t, _ts: ts });
  }
  recent.sort((a, b) => b._ts - a._ts);

  const projectShares = {};
  const total = recent.length || 1;
  for (const t of recent) {
    const key = t.projectId || '__none__';
    projectShares[key] = (projectShares[key] || 0) + 1;
  }
  for (const key in projectShares) projectShares[key] /= total;

  const mostRecent = recent[0] || null;
  const mostRecentAge = mostRecent ? now - mostRecent._ts : Infinity;

  return {
    now,
    projectShares,
    recentCount: recent.length,
    mostRecent,
    mostRecentAge,
  };
};

// ---------------------------------------------------------------------------
// Name-similarity helpers (Jaccard over lowercased word sets, stopwords stripped)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'on', 'in', 'to', 'and', 'with', 'do', 'my',
  'some', 'any', 'at', 'by', 'from', 'or', 'but', 'is', 'it', 'this', 'that',
  'i', 'me', 'new', 'up',
]);

const tokenizeName = (name = '') => {
  const matches = String(name).toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return new Set();
  const out = new Set();
  for (const w of matches) {
    if (w.length > 1 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
};

const jaccardSimilarity = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

// ---------------------------------------------------------------------------
// Extended slope components
// ---------------------------------------------------------------------------

/**
 * procrastinationWeight — compound bonus for aversive tasks that have been
 * sitting on the list a long time. Low-aversion tasks are unaffected
 * (the (aversion - 1.0) factor collapses to zero).
 *
 *   aversion 1 → always 1.0 (no bump regardless of age)
 *   aversion 3, 14+ days old → 1.0 + 0.8 = 1.8×
 */
export const getProcrastinationWeight = (todo, now = Date.now()) => {
  if (!todo?.createdAt) return 1.0;
  const daysOld = Math.max(0, (now - new Date(todo.createdAt).getTime()) / DAY);
  const aversion = getAversionWeight(todo);
  const ageFactor = Math.min(daysOld / 14, 1);
  return 1.0 + (aversion - 1.0) * ageFactor;
};

/**
 * sizeWeight — accounts for task size via work-per-remaining-day.
 *
 * A 4 h/day task and a 30 min/day task should not look identical when their
 * due dates and aversions match: the larger one demands attention now. sqrt
 * compression keeps the factor bounded.
 *
 *   Anchor: 60 min/day → 1.0
 *   30 min/day → ~0.71,   240 min/day → ~2.0 (cap)
 */
export const getSizeWeight = (todo) => {
  const wpd = getTodoWPD(todo);
  if (!Number.isFinite(wpd) || wpd <= 0) return 1.0;
  return Math.min(2.0, Math.max(0.7, Math.sqrt(wpd / 60)));
};

/**
 * saturationPenalty — penalises a todo whose project has dominated recent
 * completions. Naturally decays as the user works elsewhere.
 *
 *   share 0%  → 1.00
 *   share 50% → 0.80
 *   share 100% → 0.60 (floor — never zeroes a project out)
 *
 * Only kicks in once the player has ≥3 recent completions, so a single
 * completion doesn't immediately penalise that project.
 */
export const getSaturationPenalty = (todo, context) => {
  if (!context?.projectShares) return 1.0;
  if ((context.recentCount || 0) < 3) return 1.0;
  const key = todo?.projectId || '__none__';
  const share = context.projectShares[key] || 0;
  return 1.0 - 0.4 * share;
};

/**
 * momentumBonus — small, time-decaying bonus (≤ +25%) for tasks whose name
 * overlaps with the MOST RECENT completed task, but only within a 2-hour
 * window. Encourages natural multi-session flow without creating a long-term
 * grind attractor (hence the short window and single-reference anchoring).
 *
 * The bonus decays linearly from +25% at t=0 to 0 at t=2h.
 */
const MOMENTUM_WINDOW_MS = 2 * HOUR;
export const getMomentumBonus = (todo, context) => {
  if (!context?.mostRecent) return 1.0;
  if (context.mostRecentAge >= MOMENTUM_WINDOW_MS) return 1.0;
  // Don't boost a todo whose name exactly matches what was just completed
  // (likely the same recurring item re-added).
  if (context.mostRecent.name && todo?.name === context.mostRecent.name) return 1.0;
  const a = tokenizeName(context.mostRecent.name);
  const b = tokenizeName(todo?.name);
  const sim = jaccardSimilarity(a, b);
  if (sim === 0) return 1.0;
  const freshness = 1 - (context.mostRecentAge / MOMENTUM_WINDOW_MS);
  return 1.0 + 0.25 * sim * freshness;
};

// ---------------------------------------------------------------------------
// Comprehensive slope — the ranking signal shown in the todo list and used
// for selection.
// ---------------------------------------------------------------------------

/**
 * getDisplaySlope — priority ranking for a todo.
 *
 * Two-arg signature:
 *   getDisplaySlope(todo)           → classical 2-factor slope (aversion × urgency).
 *                                     Safe fallback for any legacy caller.
 *   getDisplaySlope(todo, context)  → full 6-factor slope:
 *       aversion × urgency × procrastination × size × saturation × momentum
 *
 *   Factor summary:
 *     aversion        1.0 – 1.8   how much the user dreads this task
 *     urgency         0.5 – 7.0   due-date pressure (or staleness if undated)
 *     procrastination 1.0 – 1.8   bonus for old, high-aversion tasks
 *     size            0.7 – 2.0   work-per-day remaining (compressed)
 *     saturation      0.6 – 1.0   down-weight if project dominates recent work
 *     momentum        1.0 – 1.25  flow bonus for similar-to-recently-completed
 *
 *   Realistic range: ~0.4 (dormant) to ~30 (critical).
 */
export const getDisplaySlope = (todo, context = null) => {
  if (!todo) return 0;
  const now = context?.now || Date.now();
  const aversion = getAversionWeight(todo);
  const urgency = getUrgencyWeight(todo, now);
  if (!context) return aversion * urgency;
  const procrastination = getProcrastinationWeight(todo, now);
  const size = getSizeWeight(todo);
  const saturation = getSaturationPenalty(todo, context);
  const momentum = getMomentumBonus(todo, context);
  return aversion * urgency * procrastination * size * saturation * momentum;
};

/**
 * slopeTier — maps a slope value to a qualitative tier for UI presentation.
 * Tuned to the realistic range of the full 6-factor slope.
 */
export const getSlopeTier = (slope) => {
  if (!Number.isFinite(slope) || slope < 1.0) return 'dormant';
  if (slope < 2.0) return 'idle';
  if (slope < 4.0) return 'active';
  if (slope < 8.0) return 'urgent';
  return 'critical';
};

// ---------------------------------------------------------------------------
// Token calculation — replaces the legacy "msToPoints / 6" divisor.
//
// Design goals (per the spec discussion):
//   • Scales roughly linearly with TIME worked (one minute ≈ one token).
//   • Also reflects genuine EFFORT, but bounded — cannot explode.
//   • Excludes urgency: urgency is a circumstance, not effort-per-minute,
//     and rewarding it here would favour procrastinators.
// ---------------------------------------------------------------------------

/**
 * effortTokenFactor — bounded multiplier in [1.0, ~2.44].
 *
 *   effort = sqrt(aversion × cappedCommitment)      → 1.0 – ~2.12
 *            (sqrt couples the two axes: needs BOTH high to approach the ceiling)
 *   × completionBonus                               → ×1.15 if the session
 *            reduces remaining estimate to zero, else ×1.0.
 *
 * Commitment is hard-capped at 2.5 before entering the sqrt so that leaving
 * the timer running overnight can't push the effort factor higher.
 */
export const getEffortTokenFactor = (todo, committedMs, actualMs) => {
  const aversion = getAversionWeight(todo);
  const commitment = Math.min(getCommitmentWeight(committedMs, actualMs), 2.5);
  const effort = Math.sqrt(aversion * commitment);

  const estimatedMinutes = Math.max(0, Number(todo?.estimatedDuration) || 0);
  const actualMinutes = Math.max(0, Number(actualMs) || 0) / MINUTE;
  const completedTask = estimatedMinutes > 0 && actualMinutes >= estimatedMinutes;
  const completionBonus = completedTask ? 1.15 : 1.0;

  return effort * completionBonus;
};

/**
 * getTokensFromTask — token payout for a completed session.
 *
 *   tokens = floor(minutesWorked × getEffortTokenFactor(...))
 *
 * Ceiling: ~2.44 tokens/minute (vs. 1 flat under the legacy formula).
 * Baseline (aversion 1, no commitment, not finished) still pays 1 token/min.
 */
export const getTokensFromTask = (todo, committedMs, actualMs) => {
  const minutes = Math.max(0, Number(actualMs) || 0) / MINUTE;
  return Math.floor(minutes * getEffortTokenFactor(todo, committedMs, actualMs));
};
