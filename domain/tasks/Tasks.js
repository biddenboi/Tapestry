import { DAY, HOUR, MINUTE } from '@domain/constants.js';
import { getLocalDate } from '@domain/time/Time.js';

export const getTaskDuration = (task) => {
  if (!task?.createdAt || !task?.completedAt) return 0;
  return Math.max(0, new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime());
};

export const getDaysUntilDue = (todo) => {
  if (!todo?.dueDate) return Infinity;
  const today = getLocalDate(new Date()).getTime();
  const due = getLocalDate(new Date(todo.dueDate)).getTime();
  return Math.max(1, Math.floor((due - today) / DAY) + 1);
};

export const getTodoWPD = (todo) => {
  if (!todo) return 1;
  if (!todo.dueDate) return 0;
  const estimated = Math.max(1, Number(todo.estimatedDuration) || 1);
  return estimated / getDaysUntilDue(todo);
};

/** Coerce raw aversion to integer in {1,2,3}. Missing → 1. */
export const coerceAversion = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > 3 ? 3 : Math.round(n);
};

// ─── Multiplier components (used by both points + slope) ────────────────

/** 1.0 / 1.4 / 1.8 for aversion 1/2/3. */
export const getAversionWeight = (todo) => 0.6 + 0.4 * coerceAversion(todo?.aversion);

/**
 * Urgency weight ∈ [0.5, 7.0]:
 *   no due date → staleness: 0d → 0.5, 7d → 1.0, 30d → ~1.6
 *   not overdue → 4 / (daysLeft + 0.25), capped at 4.0, floored at 0.5
 *   overdue     → min(4 + 0.3·|daysOverdue|, 7)
 */
export const getUrgencyWeight = (todo, now = Date.now()) => {
  if (!todo?.dueDate) {
    if (!todo?.createdAt) return 0.5;
    const daysOnList = Math.max(0, (now - new Date(todo.createdAt).getTime()) / DAY);
    return 0.5 + 0.5 * Math.log2(1 + daysOnList / 7);
  }
  const today = getLocalDate(new Date(now)).getTime();
  const due = getLocalDate(new Date(todo.dueDate)).getTime();
  const days = (due - today) / DAY;
  if (days >= 0) return Math.min(4.0, Math.max(0.5, 4.0 / (days + 0.25)));
  return Math.min(7.0, 4.0 + 0.3 * Math.abs(days));
};

/** 15min=1.0×, 60min=2.0×, 120min=2.5×. Only awarded when actual ≥ committed. */
export const getCommitmentWeight = (committedMs, actualMs) => {
  if (!committedMs || committedMs <= 0) return 1.0;
  const raw = 1.0 + 0.5 * Math.log2((committedMs / MINUTE) / 15);
  return actualMs >= committedMs ? Math.max(1.0, raw) : 1.0;
};

/** Points multiplier for completed tasks: aversion × urgency × commitment. */
export const getTaskMultiplier = (todo, committedMs, actualMs) =>
  getAversionWeight(todo) * getUrgencyWeight(todo) * getCommitmentWeight(committedMs, actualMs);

// ─── Slope context (computed once per list render) ──────────────────────

export const buildSlopeContext = (completedTasks = []) => {
  const now = Date.now();
  const cutoff = now - 3 * DAY;

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
  for (const k in projectShares) projectShares[k] /= total;

  const mostRecent = recent[0] || null;
  return {
    now,
    projectShares,
    recentCount: recent.length,
    mostRecent,
    mostRecentAge: mostRecent ? now - mostRecent._ts : Infinity,
  };
};

// ─── Name similarity (for momentum bonus) ───────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'on', 'in', 'to', 'and', 'with', 'do', 'my',
  'some', 'any', 'at', 'by', 'from', 'or', 'but', 'is', 'it', 'this', 'that',
  'i', 'me', 'new', 'up',
]);

const tokenizeName = (name = '') => {
  const matches = String(name).toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return new Set();
  const out = new Set();
  for (const w of matches) if (w.length > 1 && !STOPWORDS.has(w)) out.add(w);
  return out;
};

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};

// ─── Extended slope components ──────────────────────────────────────────

/** Compound bonus for old, aversive tasks. Aversion-1 tasks unaffected. */
export const getProcrastinationWeight = (todo, now = Date.now()) => {
  if (!todo?.createdAt) return 1.0;
  const daysOld = Math.max(0, (now - new Date(todo.createdAt).getTime()) / DAY);
  return 1.0 + (getAversionWeight(todo) - 1.0) * Math.min(daysOld / 14, 1);
};

/** sqrt(work-per-day / 60), clamped to [0.7, 2.0]. */
export const getSizeWeight = (todo) => {
  const wpd = getTodoWPD(todo);
  if (!Number.isFinite(wpd) || wpd <= 0) return 1.0;
  return Math.min(2.0, Math.max(0.7, Math.sqrt(wpd / 60)));
};

/** Penalty when a project dominates recent completions. Floors at 0.6×. */
export const getSaturationPenalty = (todo, ctx) => {
  if (!ctx?.projectShares || (ctx.recentCount || 0) < 3) return 1.0;
  const share = ctx.projectShares[todo?.projectId || '__none__'] || 0;
  return 1.0 - 0.4 * share;
};

/** Up to +25% for tasks with names similar to the most recently completed, decaying over 2h. */
const MOMENTUM_WINDOW_MS = 2 * HOUR;
export const getMomentumBonus = (todo, ctx) => {
  if (!ctx?.mostRecent || ctx.mostRecentAge >= MOMENTUM_WINDOW_MS) return 1.0;
  if (ctx.mostRecent.name && todo?.name === ctx.mostRecent.name) return 1.0;
  const sim = jaccard(tokenizeName(ctx.mostRecent.name), tokenizeName(todo?.name));
  if (!sim) return 1.0;
  return 1.0 + 0.25 * sim * (1 - ctx.mostRecentAge / MOMENTUM_WINDOW_MS);
};

// ─── Slope ──────────────────────────────────────────────────────────────

/**
 * Display slope. With context: 6-factor (aversion·urgency·procrastination·size·saturation·momentum).
 * Without: 2-factor fallback (aversion·urgency).
 */
export const getDisplaySlope = (todo, ctx = null) => {
  if (!todo) return 0;
  const now = ctx?.now || Date.now();
  const a = getAversionWeight(todo);
  const u = getUrgencyWeight(todo, now);
  if (!ctx) return a * u;
  return a * u
    * getProcrastinationWeight(todo, now)
    * getSizeWeight(todo)
    * getSaturationPenalty(todo, ctx)
    * getMomentumBonus(todo, ctx);
};

export const getSlopeTier = (slope) => {
  if (!Number.isFinite(slope) || slope < 1.0) return 'dormant';
  if (slope < 2.0) return 'idle';
  if (slope < 4.0) return 'active';
  if (slope < 8.0) return 'urgent';
  return 'critical';
};

/** Slope^1.5 normalised to 0–100 percentages. Used for chip intensity + selection weights. */
export const getSlopes = (todoArray = [], ctx = null) => {
  if (!todoArray.length) return [];
  const raw = todoArray.map((t) => Math.max(0, getDisplaySlope(t, ctx)) ** 1.5);
  const total = raw.reduce((s, w) => s + w, 0);
  if (!total) return todoArray.map(() => 100 / todoArray.length);
  return raw.map((w) => (w / total) * 100);
};

// ─── Token payout ───────────────────────────────────────────────────────
// tokens = floor(minutes × effort × completionBonus). Effort ∈ [1, ~2.12]
// from sqrt(aversion × cappedCommitment); +15% if session completed the todo.

export const getEffortTokenFactor = (todo, committedMs, actualMs) => {
  const a = getAversionWeight(todo);
  const c = Math.min(getCommitmentWeight(committedMs, actualMs), 2.5);
  const effort = Math.sqrt(a * c);

  const estMin = Math.max(0, Number(todo?.estimatedDuration) || 0);
  const actMin = Math.max(0, Number(actualMs) || 0) / MINUTE;
  const completed = estMin > 0 && actMin >= estMin;
  return effort * (completed ? 1.15 : 1.0);
};

export const getTokensFromTask = (todo, committedMs, actualMs) => {
  const minutes = Math.max(0, Number(actualMs) || 0) / MINUTE;
  return Math.floor(minutes * getEffortTokenFactor(todo, committedMs, actualMs));
};

export const getAllWPDFromArray = (data = []) => data.map((t) => getTodoWPD(t));
export function createTaskDraft({
  dueDate = null,
  projectId = null,
  estimatedDuration = 30,
} = {}) {
  return {
    UUID: null,
    name: '',
    dueDate,
    estimatedDuration,
    projectId,
    aversion: 1,
    efficiency: '',
  };
}
