import { DAY, HOUR, WEEK, STRING_DAYS } from '../constants.js';

/** Current in-game time (ms) for a player. Active players accumulate from utcTimeAtStart. */
export function getCurrentIGT(player, nowMs = Date.now()) {
  if (!player) return 0;
  const parsedBase = Number(player.inGameTime);
  const base = Number.isFinite(parsedBase) ? Math.max(0, parsedBase) : 0;
  if (!player.utcTimeAtStart) return base;
  const startedAt = new Date(player.utcTimeAtStart).getTime();
  const now = Number(nowMs);
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return base;
  return base + Math.max(0, now - startedAt);
}

/** Format in-game time as "Day N · HH:MM". */
export function formatInGameTime(ms) {
  const parsed = Number(ms);
  const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  const day = Math.floor(safe / DAY) + 1;
  const rem = safe % DAY;
  const h = Math.floor(rem / HOUR);
  const m = Math.floor((rem % HOUR) / 60000);
  return `Day ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Map/world presentation specified as "DAY N · HH:MM". */
export function formatWorldIGT(ms) {
  return formatInGameTime(ms).toUpperCase();
}

export const timeAsHHMMSS = (ms = 0) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const msToPoints = (ms = 0) => Math.max(0, Math.floor(ms / 10000));

export const getLocalDate = (input = new Date()) => {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Milliseconds until the player's wakeTime ("HH:MM"); rolls to tomorrow if already past today. 0 on invalid input. */
export const getMsUntilWakeTime = (wakeTime) => {
  if (!wakeTime || typeof wakeTime !== 'string') return 0;
  const [h, m] = wakeTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
};

/** Wall-clock Date for the player's wakeTime ("HH:MM") on a given calendar day; null on invalid input. */
export const getWakeDateForDate = (wakeTime, baseDate = new Date()) => {
  if (!wakeTime || typeof wakeTime !== 'string') return null;
  const [h, m] = wakeTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
};

export function prettyPrintDate(date) {
  if (!date) return 'No due date';
  const dateObj = new Date(date);
  const today = getLocalDate(new Date());
  const timeTill = getLocalDate(dateObj).getTime() - today.getTime();
  if (timeTill < 0) return 'Overdue';
  if (timeTill < DAY) return 'Today';
  if (timeTill < 2 * DAY) return 'Tomorrow';
  if (timeTill < WEEK - DAY) return STRING_DAYS[dateObj.getDay()];
  if (timeTill < 2 * WEEK - DAY) return `Next ${STRING_DAYS[dateObj.getDay()]}`;
  return date.split('T')[0];
}

export function formatDuration(ms) {
  if (ms == null) return null;
  const abs = Math.abs(ms);
  if (abs < 5000) return '0m';
  const totalMin = Math.floor(abs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function UTCStringToLocalTime(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function UTCStringToLocalDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
