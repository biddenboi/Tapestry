import * as chrono from 'chrono-node';

/* ═════════════════════════════════════════════════════════════
 *  Duration parsing — free-text → minutes
 *  Accepts: "5", "5m", "5 min", "5 minutes", "five minutes",
 *           "1hr", "1 hour", "10 hours", "1h 30m", "1h30m",
 *           "1 hour 30 minutes", "half an hour", "quarter hour",
 *           "in 3 hours"
 * ═════════════════════════════════════════════════════════════ */

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
  half: 0.5, quarter: 0.25,
};

const HOUR_TOKENS = new Set(['h', 'hr', 'hrs', 'hour', 'hours']);
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

/**
 * Parse a natural-language duration into minutes.
 * Returns { minutes, display } or { minutes: null, display: '', error: true }.
 */
export function parseDuration(input) {
  const raw = String(input || '').trim();
  if (!raw) return { minutes: null, display: '' };

  const tokens = tokenize(raw);
  if (tokens.length === 0) return { minutes: null, display: '', error: true };

  let totalMinutes = 0;
  let pendingNumber = null;
  let sawAnything = false;

  for (const tok of tokens) {
    const num = asNumber(tok);

    if (num !== null) {
      // Compound numbers: "twenty five" → 25, "one hundred" → 100
      if (pendingNumber !== null && num < pendingNumber && num < 100) {
        pendingNumber += num;
      } else if (pendingNumber !== null && num === 100) {
        pendingNumber = (pendingNumber || 1) * 100;
      } else {
        pendingNumber = num;
      }
      sawAnything = true;
      continue;
    }

    if (HOUR_TOKENS.has(tok)) {
      totalMinutes += (pendingNumber ?? 1) * 60;
      pendingNumber = null;
      sawAnything = true;
    } else if (MINUTE_TOKENS.has(tok)) {
      totalMinutes += (pendingNumber ?? 1);
      pendingNumber = null;
      sawAnything = true;
    } else if (SECOND_TOKENS.has(tok)) {
      totalMinutes += (pendingNumber ?? 1) / 60;
      pendingNumber = null;
      sawAnything = true;
    }
    // Unknown tokens silently ignored
  }

  // Trailing bare number with no unit → assume minutes
  if (pendingNumber !== null) {
    totalMinutes += pendingNumber;
    sawAnything = true;
  }

  if (!sawAnything || totalMinutes <= 0) {
    return { minutes: null, display: '', error: true };
  }

  const minutes = Math.max(1, Math.round(totalMinutes));
  return { minutes, display: formatDurationDisplay(minutes) };
}

function formatDurationDisplay(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h}h ${m}m`;
}

/* ═════════════════════════════════════════════════════════════
 *  Date parsing — free-text → ISO string
 *  Rules (per spec):
 *    date only → set time to 23:59 local
 *    time only → today's LOCAL calendar date at that time
 *    date+time → use as-is
 * ═════════════════════════════════════════════════════════════ */

function finalizeDateResult(result) {
  const hasDay = result.start.isCertain('day')
    || result.start.isCertain('weekday')
    || result.start.isCertain('month');
  const hasHour = result.start.isCertain('hour');

  let date = result.start.date();

  if (hasDay && !hasHour) {
    date.setHours(23, 59, 0, 0);
  } else if (!hasDay && hasHour) {
    const today = new Date();
    today.setHours(
      result.start.get('hour') ?? 0,
      result.start.get('minute') ?? 0,
      0, 0,
    );
    date = today;
  } else if (hasDay && hasHour) {
    date.setSeconds(0, 0);
  } else {
    return null;
  }

  return {
    iso: date.toISOString(),
    date,
    display: formatDueDateDisplay(date),
  };
}

/**
 * Parse a natural-language due date from a focused input.
 * Returns { iso, date, display } or { iso: null, display: '', error: true }.
 */
export function parseDueDate(input) {
  const text = String(input || '').trim();
  if (!text) return { iso: null, display: '' };

  let results;
  try {
    results = chrono.parse(text, new Date(), { forwardDate: true });
  } catch {
    return { iso: null, display: '', error: true };
  }
  if (!results || results.length === 0) {
    return { iso: null, display: '', error: true };
  }
  const finalized = finalizeDateResult(results[0]);
  return finalized || { iso: null, display: '', error: true };
}

function formatDueDateDisplay(date) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const targetDayStart = new Date(date);
  targetDayStart.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((targetDayStart.getTime() - dayStart.getTime()) / 86400000);

  let dayLabel;
  if (dayDiff === 0) dayLabel = 'Today';
  else if (dayDiff === 1) dayLabel = 'Tomorrow';
  else if (dayDiff === -1) dayLabel = 'Yesterday';
  else if (dayDiff > 1 && dayDiff < 7) {
    dayLabel = date.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    dayLabel = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
  }
  const timeLabel = date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  return `${dayLabel} at ${timeLabel}`;
}

/* ═════════════════════════════════════════════════════════════
 *  Combined parser — one text field → { name, dueDate, duration }
 *  Todoist-style: user types "Buy groceries tomorrow 5pm 30min"
 *  and we extract each field.
 *
 *  Algorithm:
 *    1. Regex-match duration phrases (unit REQUIRED to avoid eating
 *       bare numbers out of the name).
 *    2. Mask duration ranges with spaces (preserving indexes) so
 *       chrono can't re-read "30 min" as "now + 30 min".
 *    3. Run chrono on masked text to find the due date.
 *    4. Subtract both ranges from the original input → name.
 * ═════════════════════════════════════════════════════════════ */

// Single-letter units use (?![a-z]) instead of \b so compounds like
// "1h30m" still match as a single token (digit-terminated "h" is ok).
const UNIT = '(?:hours?|hrs?|h(?![a-z])|minutes?|mins?|m(?![a-z])|seconds?|secs?|s(?![a-z]))';

const DURATION_RE = new RegExp(
  '\\b(?:' +
    // "half an hour" / "quarter hour"
    '(?:half|quarter)\\s+(?:an?\\s+|of\\s+an?\\s+)?(?:hours?|hrs?|minutes?|mins?)\\b' +
  '|' +
    // Numeric + unit, repeated for compounds ("1h30m", "2 hours 15 minutes")
    '\\d+(?:\\.\\d+)?\\s*' + UNIT +
    '(?:\\s*\\d+(?:\\.\\d+)?\\s*' + UNIT + ')*' +
  '|' +
    // Word-number + unit ("twenty five minutes")
    '(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|' +
    'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|' +
    'thirty|forty|fifty|sixty|seventy|eighty|ninety)' +
    '(?:[-\\s]+(?:one|two|three|four|five|six|seven|eight|nine))?' +
    '\\s+(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\\b' +
  ')',
  'gi',
);

/**
 * Parse a single combined text input into { name, dueDate, duration, ranges }.
 * Each sub-field is the same shape returned by parseDueDate / parseDuration.
 *
 * Options:
 *   excludeDate     — treat any detected date as part of the name (skip chrono)
 *   excludeDuration — treat any detected duration as part of the name
 *
 * ranges: { date: [start, end] | null, duration: [start, end] | null }
 *   Character positions in the ORIGINAL input string. Used by the UI to
 *   render highlight overlays on matched tokens.
 */
export function parseCombinedInput(text, { excludeDate = false, excludeDuration = false } = {}) {
  const input = String(text || '');
  const empty = {
    name: '',
    dueDate: { iso: null, display: '' },
    duration: { minutes: null, display: '' },
    ranges: { date: null, duration: null },
  };
  if (!input.trim()) return empty;

  // Pass 1: duration ranges via regex.
  const durationRanges = [];
  let durationText = '';
  DURATION_RE.lastIndex = 0;
  let m;
  while ((m = DURATION_RE.exec(input)) !== null) {
    // "in 30 minutes" → let chrono interpret as a relative date instead.
    const before = input.substring(Math.max(0, m.index - 4), m.index);
    if (/(^|\s)in\s$/i.test(before)) continue;
    durationRanges.push([m.index, m.index + m[0].length]);
    durationText += (durationText ? ' ' : '') + m[0];
  }

  // When duration is excluded, act as if no duration was matched.
  const activeDurationRanges = excludeDuration ? [] : durationRanges;
  const activeDurationText   = excludeDuration ? '' : durationText;

  // Pass 2: mask duration ranges with spaces (positions preserved) and run
  // chrono. This prevents chrono from seeing "30 min" as "now + 30 min".
  let masked = input;
  for (const [s, e] of activeDurationRanges) {
    masked = masked.substring(0, s) + ' '.repeat(e - s) + masked.substring(e);
  }
  let chronoResults = [];
  if (!excludeDate) {
    try {
      chronoResults = chrono.parse(masked, new Date(), { forwardDate: true }) || [];
    } catch { /* noop */ }
  }
  const dateResult = chronoResults[0] || null;
  const dateRange  = dateResult
    ? [dateResult.index, dateResult.index + dateResult.text.length]
    : null;

  // Pass 3: strip all active matched ranges from the ORIGINAL input → name.
  const ranges = [...activeDurationRanges];
  if (dateRange) ranges.push(dateRange);
  ranges.sort((a, b) => a[0] - b[0]);

  let name = '';
  let cursor = 0;
  for (const [s, e] of ranges) {
    name += input.substring(cursor, s);
    cursor = e;
  }
  name += input.substring(cursor);
  name = name
    .replace(/\s+/g, ' ')
    .replace(/\s*[,;]\s*/g, ' ')
    .trim()
    .replace(/^(?:for|on|by|at|in)\s+/i, '')
    .replace(/\s+(?:for|on|by|at|in)$/i, '')
    .trim();

  const duration = activeDurationText
    ? parseDuration(activeDurationText)
    : { minutes: null, display: '' };

  let dueDate = { iso: null, display: '' };
  if (dateResult) {
    const finalized = finalizeDateResult(dateResult);
    if (finalized) dueDate = finalized;
  }

  return {
    name,
    dueDate,
    duration,
    // Character ranges in the original input — null when not matched or excluded.
    ranges: {
      date:     excludeDate     ? null : (dateRange ?? null),
      duration: excludeDuration ? null : (durationRanges[0] ?? null),
    },
  };
}