
import { DAY, WEEK, STRING_DAYS } from '../Constants';

// ── Formatting ────────────────────────────────────────────────────────────────

export const timeAsHHMMSS = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
};

export const msToSeconds = (ms) => Math.floor(ms / 1000);
export const msToPoints  = (ms) => Math.floor(ms / 10000);

export const getMidnightOfDate = (date) =>
  new Date(date.toLocaleString('sv').split(' ')[0] + 'T00:00:00');

export const getMidnightInUTC = (date) => {
  const d = new Date(date);
  return new Date(d.toLocaleString('sv').split(' ')[0] + 'T00:00:00').toISOString();
};

export const getLocalDate = (date) =>
  new Date(date.toLocaleString('sv').replace(' ', 'T'));

export const formatDateAsLocalString = (date) =>
  date.toLocaleString('sv').replace(' ', 'T');

export const addDurationToDate = (date, ms) =>
  new Date(date.getTime() + ms);

export const getMsUntilMidnight = () => {
  const now      = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
};

function _isoFromDate(date) {
  return date.toISOString().split('T')[0];
}

// ── Natural language date parser ──────────────────────────────────────────────
// Returns a YYYY-MM-DD string or '' if unparseable.
export const parseNaturalDate = (input) => {
  if (!input) return '';
  const s = input.toLowerCase().trim();

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const now = new Date();

  if (s === 'today')     return _isoFromDate(now);
  if (s === 'yesterday') { const d = new Date(now); d.setDate(d.getDate()-1); return _isoFromDate(d); }
  if (s === 'tomorrow')  { const d = new Date(now); d.setDate(d.getDate()+1); return _isoFromDate(d); }

  // "in N days / weeks / months"
  const inMatch = s.match(/^in (\d+)\s+(day|days|week|weeks|month|months)$/);
  if (inMatch) {
    const n  = parseInt(inMatch[1]);
    const d  = new Date(now);
    const unit = inMatch[2];
    if (unit.startsWith('day'))   d.setDate(d.getDate() + n);
    if (unit.startsWith('week'))  d.setDate(d.getDate() + n * 7);
    if (unit.startsWith('month')) d.setMonth(d.getMonth() + n);
    return _isoFromDate(d);
  }

  // "next <weekday>" or bare weekday name
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const nextMatch = s.match(/^(?:next )?(\w+)$/);
  if (nextMatch) {
    const idx = DAYS.indexOf(nextMatch[1]);
    if (idx !== -1) {
      const d    = new Date(now);
      const curr = d.getDay();
      let diff   = idx - curr;
      // "next Monday" always jumps to next week's Monday even if today is Monday
      if (s.startsWith('next')) { if (diff <= 0) diff += 7; }
      else                      { if (diff <= 0) diff += 7; }
      d.setDate(d.getDate() + diff);
      return _isoFromDate(d);
    }
  }

  // "end of week" / "end of month"
  if (s === 'end of week') {
    const d = new Date(now); d.setDate(d.getDate() + (7 - d.getDay()));
    return _isoFromDate(d);
  }
  if (s === 'end of month') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return _isoFromDate(d);
  }

  return '';
};

// ── Pretty-print ──────────────────────────────────────────────────────────────

export function getTimeAsString(dateStr) {
  const time  = dateStr.split('T')[1]?.split('Z')[0];
  if (!time) return '';
  const hours   = parseInt(time.split(':')[0]);
  const minutes = time.split(':')[1];
  return hours > 12
    ? `${hours % 12}:${minutes} pm`
    : `${hours}:${minutes} am`;
}

export function prettyPrintDate(date) {
  if (!date) return '';
  const currentTime = new Date().getTime();
  const dateObj     = new Date(date + (date.includes('T') ? '' : 'T00:00'));
  const timeTill    = dateObj.getTime() - currentTime;

  if (timeTill < 0)           return 'Overdue';
  if (timeTill < DAY)         return 'Today';
  if (timeTill < 2 * DAY)     return 'Tomorrow';
  if (timeTill < WEEK - DAY)  return STRING_DAYS[dateObj.getDay()];
  if (timeTill < 2 * WEEK - DAY) return 'Next ' + STRING_DAYS[dateObj.getDay()];
  return date.split('T')[0];
}

export function formatDuration(ms) {
  if (!ms || ms < 5000) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function UTCStringToLocalTime(dateString) {
  if (!dateString) return '';
  return getTimeAsString(formatDateAsLocalString(new Date(dateString)));
}

export function UTCStringToLocalDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function getDateAsString(date) {
  return date.split('T')[0];
}