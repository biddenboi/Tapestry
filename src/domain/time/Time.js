import { DAY, HOUR, WEEK, STRING_DAYS } from '../constants.js';

export const PROFILE_IGT_CLOCK_VERSION = 2;
export const PROFILE_IGT_ACTIVITY_RECOVERY_VERSION = 1;

const LEGACY_PROFILE_ACTIVITY_TYPES = new Set([
  'wake',
  'enter',
  'item_use',
  'end_work',
  'end-work',
]);

export function needsProfileIGTActivityRecovery(player) {
  return (Number(player?.igtActivityRecoveryVersion) || 0)
    < PROFILE_IGT_ACTIVITY_RECOVERY_VERSION;
}

function localCalendarDay(date) {
  return Math.trunc(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

function localTimeOfDay(date) {
  return date.getHours() * HOUR
    + date.getMinutes() * 60_000
    + date.getSeconds() * 1000
    + date.getMilliseconds();
}

export function getIGTDateKey(value = Date.now()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarDayFromKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!match) return null;
  const value = Math.trunc(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY);
  return Number.isFinite(value) ? value : null;
}

function storedIGT(player) {
  const parsed = Number(player?.inGameTime);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function dayBase(igt) {
  return Math.floor(Math.max(0, Number(igt) || 0) / DAY) * DAY;
}

function finiteTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function addLocalDateRange(target, startMs, endMs) {
  const start = new Date(startMs);
  const endKey = getIGTDateKey(endMs);
  if (!endKey || !Number.isFinite(start.getTime())) return;
  start.setHours(12, 0, 0, 0);
  for (let safety = 0; safety < 10_000; safety += 1) {
    const key = getIGTDateKey(start);
    if (!key) return;
    target.add(key);
    if (key === endKey) return;
    start.setDate(start.getDate() + 1);
  }
}

/**
 * Recover legacy per-profile days from observed activation intervals.
 *
 * Creation activates a profile. A wake, enter, item-use, or end-work event
 * confirms which profile was active next. Consecutive evidence for the same
 * profile leaves its interval open, so real midnights crossed without a
 * profile switch still count. Evidence for another profile freezes it.
 */
export function buildLegacyProfileIGTRecovery(players = [], {
  activityEvents = [],
  activePlayerUUID = null,
  activeStateUpdatedAt = null,
  nowMs = Date.now(),
} = {}) {
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return new Map();
  const knownPlayers = new Map(
    (players || [])
      .filter((player) => player?.UUID)
      .map((player) => [String(player.UUID), player]),
  );
  const points = [];
  for (const player of knownPlayers.values()) {
    const atMs = finiteTimestamp(player.createdAt);
    if (atMs != null && atMs <= now) {
      points.push({ playerUUID: String(player.UUID), atMs, priority: 0 });
    }
  }
  for (const event of activityEvents || []) {
    const playerUUID = String(event?.playerUUID || event?.playerId || event?.parent || '');
    if (!knownPlayers.has(playerUUID)
      || !LEGACY_PROFILE_ACTIVITY_TYPES.has(String(event?.eventType || event?.type || ''))) {
      continue;
    }
    const atMs = finiteTimestamp(event.createdAt || event.loggedAt);
    if (atMs != null && atMs <= now) points.push({ playerUUID, atMs, priority: 1 });
  }
  points.sort((left, right) => (
    left.atMs - right.atMs
    || left.priority - right.priority
    || left.playerUUID.localeCompare(right.playerUUID)
  ));

  const switches = [];
  for (const point of points) {
    if (switches.at(-1)?.playerUUID !== point.playerUUID) switches.push(point);
  }
  const activeUUID = activePlayerUUID && knownPlayers.has(String(activePlayerUUID))
    ? String(activePlayerUUID)
    : null;
  if (activeUUID && switches.at(-1)?.playerUUID !== activeUUID) {
    const stateAt = finiteTimestamp(activeStateUpdatedAt);
    switches.push({
      playerUUID: activeUUID,
      atMs: Math.max(
        switches.at(-1)?.atMs || 0,
        stateAt != null && stateAt <= now ? stateAt : now,
      ),
      priority: 2,
    });
  }

  const datesByPlayer = new Map(
    [...knownPlayers.keys()].map((UUID) => [UUID, new Set()]),
  );
  const lastBoundaryByPlayer = new Map();
  for (let index = 0; index < switches.length; index += 1) {
    const current = switches[index];
    const next = switches[index + 1];
    const endMs = next?.atMs ?? now;
    addLocalDateRange(
      datesByPlayer.get(current.playerUUID),
      current.atMs,
      Math.max(current.atMs, endMs),
    );
    lastBoundaryByPlayer.set(current.playerUUID, Math.max(current.atMs, endMs));
  }

  const recovered = new Map();
  for (const [UUID, player] of knownPlayers.entries()) {
    const dates = datesByPlayer.get(UUID);
    if (!dates.size) {
      const createdAt = finiteTimestamp(player.createdAt);
      if (createdAt != null) dates.add(getIGTDateKey(createdAt));
    }
    const savedDayIndex = Math.floor(storedIGT(player) / DAY);
    const recoveredDayIndex = Math.max(savedDayIndex, Math.max(0, dates.size - 1));
    const active = UUID === activeUUID;
    const boundaryMs = active
      ? now
      : (lastBoundaryByPlayer.get(UUID) ?? finiteTimestamp(player.createdAt) ?? now);
    recovered.set(UUID, {
      inGameTime: recoveredDayIndex * DAY + localTimeOfDay(new Date(boundaryMs)),
      igtActive: active,
      igtLastActiveDate: getIGTDateKey(boundaryMs),
      igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
      igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
      recoveredActiveDays: Math.max(savedDayIndex + 1, dates.size || 1),
    });
  }
  return recovered;
}

/**
 * Current in-game time (ms) for a player.
 *
 * Real-world time supplies the day boundary and HH:MM. Only the active
 * profile advances. Inactive profiles retain their last persisted cursor.
 *
 * If an active profile remains selected across one or more local midnights,
 * each crossed boundary advances that profile by one IGT day. Switching away
 * freezes it; switching back on a later date advances it by one profile-day,
 * regardless of how many dates passed while it was inactive.
 */
export function getCurrentIGT(player, nowMs = Date.now()) {
  const now = Number(nowMs);
  const snapshot = storedIGT(player);
  if (!player?.igtActive || !Number.isFinite(now)) return snapshot;
  const nowDate = new Date(now);
  const anchorDay = calendarDayFromKey(player.igtLastActiveDate);
  const crossedDays = anchorDay == null
    ? 0
    : Math.max(0, localCalendarDay(nowDate) - anchorDay);
  return dayBase(snapshot) + crossedDays * DAY + localTimeOfDay(nowDate);
}

/**
 * Activate a profile at the real-world clock.
 *
 * Re-entering on the same local date does not add another day. Entering on a
 * later date adds exactly one day because the dates spent inactive do not
 * belong to this profile.
 */
export function activatePlayerIGT(player, nowMs = Date.now()) {
  if (!player) return player;
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return { ...player };
  const dateKey = getIGTDateKey(now);
  const current = player.igtActive ? getCurrentIGT(player, now) : storedIGT(player);
  const previousDate = getIGTDateKey(player.igtLastActiveDate);
  const shouldAdvance = !player.igtActive
    && Boolean(previousDate)
    && previousDate !== dateKey;
  const nextBase = dayBase(current) + (shouldAdvance ? DAY : 0);
  return {
    ...player,
    igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
    igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
    igtActive: true,
    igtLastActiveDate: dateKey,
    inGameTime: nextBase + localTimeOfDay(new Date(now)),
  };
}

/** Freeze a profile at the time it stops being active. */
export function freezePlayerIGT(player, nowMs = Date.now()) {
  if (!player) return player;
  const now = Number(nowMs);
  const current = getCurrentIGT(player, now);
  return {
    ...player,
    igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
    igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
    igtActive: false,
    ...(Number.isFinite(now) ? { igtLastActiveDate: getIGTDateKey(now) } : {}),
    inGameTime: current,
  };
}

/**
 * Upgrade creation-epoch saves without importing their inflated wall-time
 * day count. The persisted player cursor is the recovery authority.
 */
export function migratePlayerIGTClock(player, {
  active = false,
  nowMs = Date.now(),
} = {}) {
  if (!player) return player;
  if (Number(player.igtClockVersion) >= PROFILE_IGT_CLOCK_VERSION) {
    if (active) return activatePlayerIGT(player, nowMs);
    return player.igtActive ? freezePlayerIGT(player, nowMs) : {
      ...player,
      igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
      igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
      igtActive: false,
      inGameTime: storedIGT(player),
    };
  }

  const migrated = {
    ...player,
    igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
    igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
    igtActive: false,
    igtLastActiveDate: getIGTDateKey(player.updatedAt || player.createdAt || nowMs),
    inGameTime: storedIGT(player),
  };
  if (!active) return migrated;

  // Restoring an already-selected legacy profile must not count every date
  // since creation. It resumes its saved IGT day at the current local time.
  return activatePlayerIGT({
    ...migrated,
    igtLastActiveDate: getIGTDateKey(nowMs),
  }, nowMs);
}

/** Persist the active clock snapshot while preserving inactive cursors. */
export function preparePlayerIGTWrite(player, existing = null, nowMs = Date.now()) {
  if (!player) return player;
  const createdAt = player.createdAt || existing?.createdAt || null;
  const merged = {
    ...existing,
    ...player,
    ...(createdAt ? { createdAt } : {}),
  };
  if (merged.igtActive) {
    const current = getCurrentIGT(merged, nowMs);
    return {
      ...merged,
      igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
      igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
      igtActive: true,
      igtLastActiveDate: getIGTDateKey(nowMs),
      inGameTime: current,
    };
  }
  return {
    ...merged,
    igtClockVersion: PROFILE_IGT_CLOCK_VERSION,
    igtActivityRecoveryVersion: PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
    igtActive: false,
    inGameTime: storedIGT(merged),
  };
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
