import * as chrono from 'chrono-node';
import { parseTaskRecurrence } from '@domain/tasks/TaskRecurrence.js';

/* ── Duration parsing ───────────────────────────────────────────────────
 * Accepts: "5", "5m", "5 min", "5 minutes", "five minutes",
 *          "1hr", "1 hour", "1h 30m", "1h30m", "half an hour", "in 3 hours"
 */

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, half: 0.5, quarter: 0.25,
};

const HOUR_TOKENS   = new Set(['h', 'hr', 'hrs', 'hour', 'hours']);
const MINUTE_TOKENS = new Set(['m', 'min', 'mins', 'minute', 'minutes']);
const SECOND_TOKENS = new Set(['s', 'sec', 'secs', 'second', 'seconds']);

function tokenize(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/-/g, ' ')
    // Split digit↔letter boundaries so "1hr" / "30m" tokenize cleanly
    .replace(/(\d+(?:\.\d+)?)([a-z]+)/g, '$1 $2')
    .replace(/([a-z]+)(\d+(?:\.\d+)?)/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => tok !== 'and' && tok !== 'an' && tok !== 'a' && tok !== 'in');
}

function asNumber(tok) {
  if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  if (NUMBER_WORDS[tok] !== undefined) return NUMBER_WORDS[tok];
  return null;
}

function formatDurationDisplay(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h}h ${m}m`;
}

/** Parse natural-language duration → { minutes, display } or { minutes:null, display:'', error:true }. */
export function parseDuration(input) {
  const raw = String(input || '').trim();
  if (!raw) return { minutes: null, display: '' };

  const tokens = tokenize(raw);
  if (!tokens.length) return { minutes: null, display: '', error: true };

  let totalMinutes = 0;
  let pending = null;
  let saw = false;

  for (const tok of tokens) {
    const num = asNumber(tok);

    if (num !== null) {
      // Compound numbers: "twenty five" → 25, "one hundred" → 100
      if (pending !== null && num < pending && num < 100) pending += num;
      else if (pending !== null && num === 100) pending = (pending || 1) * 100;
      else pending = num;
      saw = true;
      continue;
    }

    if (HOUR_TOKENS.has(tok))        { totalMinutes += (pending ?? 1) * 60; pending = null; saw = true; }
    else if (MINUTE_TOKENS.has(tok)) { totalMinutes += (pending ?? 1);      pending = null; saw = true; }
    else if (SECOND_TOKENS.has(tok)) { totalMinutes += (pending ?? 1) / 60; pending = null; saw = true; }
    // unknown tokens silently ignored
  }

  // Trailing bare number with no unit → assume minutes
  if (pending !== null) { totalMinutes += pending; saw = true; }

  if (!saw || totalMinutes <= 0) return { minutes: null, display: '', error: true };
  const minutes = Math.max(1, Math.round(totalMinutes));
  return { minutes, display: formatDurationDisplay(minutes) };
}

/* ── Date parsing ───────────────────────────────────────────────────────
 *   date only → 23:59 local
 *   time only → today at that time
 *   date+time → as-is
 */

function formatDueDateDisplay(date) {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const targetStart = new Date(date); targetStart.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((targetStart.getTime() - dayStart.getTime()) / 86400000);

  let dayLabel;
  if (dayDiff === 0)       dayLabel = 'Today';
  else if (dayDiff === 1)  dayLabel = 'Tomorrow';
  else if (dayDiff === -1) dayLabel = 'Yesterday';
  else if (dayDiff > 1 && dayDiff < 7) {
    dayLabel = date.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    dayLabel = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
  }
  const timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel} at ${timeLabel}`;
}

function finalizeDateResult(result) {
  const hasDay = result.start.isCertain('day') || result.start.isCertain('weekday') || result.start.isCertain('month');
  const hasHour = result.start.isCertain('hour');
  let date = result.start.date();

  if (hasDay && !hasHour) {
    date.setHours(23, 59, 0, 0);
  } else if (!hasDay && hasHour) {
    date = new Date();
    date.setHours(result.start.get('hour') ?? 0, result.start.get('minute') ?? 0, 0, 0);
  } else if (hasDay && hasHour) {
    date.setSeconds(0, 0);
  } else {
    return null;
  }
  return { iso: date.toISOString(), date, display: formatDueDateDisplay(date) };
}

/** Parse natural-language due date → { iso, date, display } or { iso:null, display:'', error:true }. */
export function parseDueDate(input) {
  const text = String(input || '').trim();
  if (!text) return { iso: null, display: '' };

  let results;
  try { results = chrono.parse(text, new Date(), { forwardDate: true }); }
  catch { return { iso: null, display: '', error: true }; }

  if (!results?.length) return { iso: null, display: '', error: true };
  return finalizeDateResult(results[0]) || { iso: null, display: '', error: true };
}

/* ── Combined parser — one text field → { name, dueDate, duration, ranges } ──
 *   1. Regex-match duration phrases (unit required so we don't eat bare numbers).
 *   2. Mask duration ranges with spaces (positions preserved) and run chrono
 *      so it can't re-read "30 min" as "now + 30 min".
 *   3. Remove all matched ranges from the original input → name.
 *   4. Re-parse the captured duration text with parseDuration (it's the
 *      authority on word-numbers, so the regex only needs to find spans).
 */

// Single-letter units use (?![a-z]) so compounds like "1h30m" still match.
const UNIT = '(?:hours?|hrs?|h(?![a-z])|minutes?|mins?|m(?![a-z])|seconds?|secs?|s(?![a-z]))';
const WORD_NUMS = '(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|'
  + 'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|'
  + 'thirty|forty|fifty|sixty|seventy|eighty|ninety)';

const DURATION_RE = new RegExp(
  '\\b(?:'
    + '(?:half|quarter)\\s+(?:an?\\s+|of\\s+an?\\s+)?(?:hours?|hrs?|minutes?|mins?)\\b'
    + '|\\d+(?:\\.\\d+)?\\s*' + UNIT + '(?:\\s*\\d+(?:\\.\\d+)?\\s*' + UNIT + ')*'
    + '|' + WORD_NUMS + '(?:[-\\s]+(?:one|two|three|four|five|six|seven|eight|nine))?'
      + '\\s+(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\\b'
  + ')',
  'gi',
);

export function parseCombinedInput(text, { excludeDate = false, excludeDuration = false } = {}) {
  const input = String(text || '');
  const empty = {
    name: '', dueDate: { iso: null, display: '' }, duration: { minutes: null, display: '' },
    recurrence: null,
    ranges: { date: null, duration: null, recurrence: null },
  };
  if (!input.trim()) return empty;

  // Pass 1: duration ranges via regex.
  const durRanges = [];
  let durText = '';
  DURATION_RE.lastIndex = 0;
  let m;
  while ((m = DURATION_RE.exec(input)) !== null) {
    // "in 30 minutes" → let chrono interpret as a relative date instead.
    if (/(^|\s)in\s$/i.test(input.substring(Math.max(0, m.index - 4), m.index))) continue;
    durRanges.push([m.index, m.index + m[0].length]);
    durText += (durText ? ' ' : '') + m[0];
  }

  const activeDurRanges = excludeDuration ? [] : durRanges;
  const activeDurText   = excludeDuration ? '' : durText;

  // Pass 2: recurrence phrases are first-class task metadata, not due dates.
  const recurrenceResult = parseTaskRecurrence(input);
  const recurrenceRange = recurrenceResult.range;

  // Pass 3: mask duration/recurrence ranges + chrono.
  let masked = input;
  for (const [s, e] of activeDurRanges) {
    masked = masked.substring(0, s) + ' '.repeat(e - s) + masked.substring(e);
  }
  if (recurrenceRange) {
    const [s, e] = recurrenceRange;
    masked = masked.substring(0, s) + ' '.repeat(e - s) + masked.substring(e);
  }
  let chronoResults = [];
  if (!excludeDate) {
    try { chronoResults = chrono.parse(masked, new Date(), { forwardDate: true }) || []; }
    catch { /* noop */ }
  }
  const dateResult = chronoResults[0] || null;
  const dateRange = dateResult ? [dateResult.index, dateResult.index + dateResult.text.length] : null;

  // Pass 4: subtract ranges → name.
  const ranges = [...activeDurRanges];
  if (dateRange) ranges.push(dateRange);
  if (recurrenceRange) ranges.push(recurrenceRange);
  ranges.sort((a, b) => a[0] - b[0]);

  let name = '';
  let cursor = 0;
  for (const [s, e] of ranges) { name += input.substring(cursor, s); cursor = e; }
  name += input.substring(cursor);
  name = name
    .replace(/\s+/g, ' ')
    .replace(/\s*[,;]\s*/g, ' ')
    .trim()
    .replace(/^(?:for|on|by|at|in)\s+/i, '')
    .replace(/\s+(?:for|on|by|at|in)$/i, '')
    .trim();

  const duration = activeDurText ? parseDuration(activeDurText) : { minutes: null, display: '' };
  let dueDate = { iso: null, display: '' };
  if (dateResult) {
    const finalized = finalizeDateResult(dateResult);
    if (finalized) dueDate = finalized;
  }

  return {
    name, dueDate, duration, recurrence: recurrenceResult.recurrence,
    ranges: {
      date:     excludeDate     ? null : (dateRange ?? null),
      duration: excludeDuration ? null : (durRanges[0] ?? null),
      recurrence: recurrenceRange,
    },
  };
}
