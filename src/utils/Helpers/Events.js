import { v4 as uuid } from 'uuid';
import {
  EVENT,
  STORES,
  SPECIAL_EVENT_IDS,
  SPECIAL_KIND,
  SPECIAL_EVENT_TUNING,
  HABIT_STREAK_CAP_DAYS,
  DAY,
} from '../Constants.js';
import { getCurrentIGT, getWakeDateForDate } from './Time.js';

async function writeEvent(db, player, type, description, createdAt = new Date().toISOString()) {
  if (!player) return null;
  const entry = {
    UUID: uuid(),
    parent: player.UUID,
    type,
    description,
    createdAt,
  };
  await db.add(STORES.event, entry);
  return entry;
}

// ── IGT-day helper ──────────────────────────────────────────────────────
export function getIgtDayNumber(player) {
  return Math.floor(getCurrentIGT(player) / DAY);
}

// ── Cross-profile date keys ─────────────────────────────────────────────
// Every event log carries a `loggedDate` stamp (YYYY-MM-DD wall-clock day).
// This is the unification key across profiles — same human, same physical day,
// regardless of which save file was active. Older logs without `loggedDate`
// fall back to deriving it from `loggedAt`. IGT day stays on logs as
// metadata (which profile's clock the log was tied to) but does NOT drive
// the day-bucket consumed by streaks / today-totals / check-in detection.

export function getDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getLogDateKey(log) {
  if (!log) return null;
  if (log.loggedDate) return log.loggedDate;
  if (log.loggedAt) return getDateKey(log.loggedAt);
  return null;
}

// Number of full calendar days between two YYYY-MM-DD keys (a < b → positive).
export function daysBetweenKeys(aKey, bKey) {
  if (!aKey || !bKey) return null;
  const a = new Date(`${aKey}T00:00:00`);
  const b = new Date(`${bKey}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

export function shiftDateKey(key, deltaDays) {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return getDateKey(d);
}

// ── Sleep-time helpers (unchanged) ──────────────────────────────────────
export function getSleepDateToday(sleepTime) {
  return getSleepDateForDate(sleepTime, new Date());
}

export function getSleepDateForDate(sleepTime, baseDate = new Date()) {
  if (!sleepTime) return null;
  const [h, m] = sleepTime.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

export function getBackfilledSleepDate(sleepTime, dayToClose = new Date()) {
  const sleepDate = getSleepDateForDate(sleepTime, dayToClose);
  if (sleepDate) return sleepDate;
  const fallback = new Date(dayToClose);
  fallback.setHours(23, 59, 59, 999);
  return fallback;
}

// ── Day boundaries ──────────────────────────────────────────────────────
export async function startDay(db, player) {
  if (!player) return;
  await db.add(STORES.player, {
    ...player,
    minutesClearedToday: 0,
  });
  await writeEvent(db, player, EVENT.wake, 'Started the day');

  // Clear stale buffs from the previous day, then back-fill any habit failures
  // for IGT days we missed while the app was closed.
  try { await db.clearEventBuffsForPlayer(player.UUID); } catch { /* non-fatal */ }
  try { await checkHabitFailures(db, player); } catch { /* non-fatal */ }
}

export async function endWorkDay(db, player) {
  if (!player) return;
  await writeEvent(db, player, EVENT.end_work, 'Ended work day');
}

export async function endDay(db, player, loseAll = false, createdAt = new Date().toISOString()) {
  if (!player) return;
  const newTokens = loseAll ? 0 : (player.tokens || 0);
  const description = loseAll
    ? 'Sleep time passed — all tokens forfeited'
    : 'Day ended — tokens preserved';

  await db.add(STORES.player, { ...player, tokens: newTokens });
  await writeEvent(db, player, EVENT.sleep, description, createdAt);

  // If the player never explicitly ended their work day, the entertainment
  // event hasn't been evaluated yet. Run it now so the day's buff state is
  // finalized before the next IGT day begins. checkEntertainmentAndLog is
  // idempotent — safe even if endWorkDay already ran it.
  try { await checkEntertainmentAndLog(db, player); } catch { /* non-fatal */ }
}

// ── Future-event prune (unchanged) ──────────────────────────────────────
export async function pruneFutureDayEvents(db, playerUUID) {
  if (!db || !playerUUID) return 0;
  const events = await db.getPlayerStore(STORES.event, playerUUID);
  if (!events || events.length === 0) return 0;
  events.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const now = Date.now();
  const toDelete = [];
  for (const entry of events) {
    const t = new Date(entry.createdAt).getTime();
    if (Number.isFinite(t) && t > now) {
      if (entry.type === EVENT.wake || entry.type === EVENT.sleep) toDelete.push(entry.UUID);
    } else {
      break;
    }
  }
  for (const id of toDelete) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.event, id);
  }
  return toDelete.length;
}

// ── Buff lifetime ───────────────────────────────────────────────────────
function getBuffExpiry(player) {
  const sleepDate = getSleepDateForDate(player?.sleepTime, new Date());
  if (sleepDate && sleepDate.getTime() > Date.now()) return sleepDate.toISOString();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return endOfToday.toISOString();
}

async function writeBuff(db, player, customEvent, multiplierValue, source, label) {
  if (!player || !customEvent) return null;
  const entry = {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    label: label || customEvent.name,
    multiplierValue,
    source,
    appliedAt: new Date().toISOString(),
    expiresAt: getBuffExpiry(player),
  };
  await db.add(STORES.eventBuff, entry);
  return entry;
}

/**
 * Replace any existing buff for this event UUID with a fresh one. Used by
 * quantity events that recompute on every log, and by anything that should
 * only have one buff record live at a time.
 */
async function replaceBuffForEvent(db, player, customEvent, multiplierValue, source, label) {
  if (!player || !customEvent) return null;
  const existing = await db.getPlayerStore(STORES.eventBuff, player.UUID);
  for (const buff of existing.filter((b) => b.eventUUID === customEvent.UUID)) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.eventBuff, buff.UUID);
  }
  return writeBuff(db, player, customEvent, multiplierValue, source, label);
}

// ── Multiplier formulas ─────────────────────────────────────────────────
export function computeHabitMultiplier(streak, maxBonusPct) {
  const cap = HABIT_STREAK_CAP_DAYS;
  const ratio = Math.min(Math.max(0, Number(streak) || 0), cap) / cap;
  const bonus = (Number(maxBonusPct) || 0) / 100;
  return 1 + bonus * ratio;
}

export function computeQuantityMultiplier(todayTotal, dailyTarget, maxBonusPct) {
  const target = Math.max(1, Number(dailyTarget) || 1);
  const ratio  = Math.min(Math.max(0, Number(todayTotal) || 0) / target, 1);
  const bonus  = (Number(maxBonusPct) || 0) / 100;
  return 1 + bonus * ratio;
}

export function computeWakeTimeMultiplier(deltaMs) {
  const { ceiling, decayMs } = SPECIAL_EVENT_TUNING.wake_time;
  const safe = Math.max(0, Number(deltaMs) || 0);
  return 1 + ceiling * Math.exp(-safe / decayMs);
}

export function computeFirstMatchMultiplier(deltaMs) {
  const { ceiling, decayMs } = SPECIAL_EVENT_TUNING.first_match;
  const safe = Math.max(0, Number(deltaMs) || 0);
  return 1 + ceiling * Math.exp(-safe / decayMs);
}

export function computeEntertainmentMultiplier() {
  return 1 + SPECIAL_EVENT_TUNING.entertainment.flatBonus;
}

// ── Habit streak utility ────────────────────────────────────────────────
/**
 * Cross-profile streak. Operates on calendar dates (YYYY-MM-DD), not IGT
 * days, so logs from any profile contribute to the same streak — they are
 * all the work of the same human in real time. Today counts if ANY profile
 * has a success log dated today; otherwise we anchor at yesterday so the
 * streak doesn't break just because the user hasn't checked in yet today.
 */
export function computeHabitStreakFromLogs(logs, todayKey = getDateKey()) {
  const successDates = new Set();
  for (const l of logs || []) {
    if (l?.status !== 'success') continue;
    const key = getLogDateKey(l);
    if (key) successDates.add(key);
  }
  if (successDates.size === 0) return 0;

  let cursor = successDates.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  // Hard cap iterations so a corrupt log set can never spin forever.
  for (let i = 0; i < 365 * 5; i += 1) {
    if (!successDates.has(cursor)) break;
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

/**
 * For each habit-type custom event, write failure logs for any calendar
 * dates strictly before today that have NO success log from ANY profile.
 * Idempotent: skips dates that already have any log (success or failure).
 *
 * Cross-profile-aware: looks at the global log set per event so a check-in
 * from any profile prevents a failure from being backfilled.
 */
export async function checkHabitFailures(db, player) {
  if (!player) return;
  const all = await db.getAllCustomEvents();
  const habits = all.filter((e) => e.type === 'habit');
  if (habits.length === 0) return;

  const todayKey = getDateKey();

  for (const habit of habits) {
    // eslint-disable-next-line no-await-in-loop
    const habitLogs = await db.getEventLogsForEvent(habit.UUID);
    const loggedKeys = new Set(habitLogs.map(getLogDateKey).filter(Boolean));

    // Earliest date to backfill from: the earliest log we have for this habit.
    // Cap at 90 days back so we don't hammer the DB on long-dormant events.
    let earliestKey = todayKey;
    for (const k of loggedKeys) {
      if (k && k < earliestKey) earliestKey = k;
    }
    const ninetyAgo = shiftDateKey(todayKey, -90);
    if (earliestKey < ninetyAgo) earliestKey = ninetyAgo;

    let cursor = earliestKey;
    while (cursor < todayKey) {
      if (!loggedKeys.has(cursor)) {
        // eslint-disable-next-line no-await-in-loop
        await db.add(STORES.eventLog, {
          UUID: uuid(),
          parent: player.UUID,
          eventUUID: habit.UUID,
          type: 'habit',
          specialKind: null,
          status: 'failure',
          value: 0,
          igtDay: getIgtDayNumber(player),
          loggedDate: cursor,
          loggedAt: new Date(`${cursor}T12:00:00`).toISOString(),
        });
        loggedKeys.add(cursor);
      }
      cursor = shiftDateKey(cursor, 1);
    }
  }
}

// ── Habit check-in (called from detail page) ────────────────────────────
export async function checkInHabit(db, player, customEvent) {
  if (!player || !customEvent || customEvent.type !== 'habit') return null;
  const todayKey = getDateKey();

  // Cross-profile dedup: any profile already checked in today → no-op.
  const allLogs = await db.getEventLogsForEvent(customEvent.UUID);
  if (allLogs.some((l) => getLogDateKey(l) === todayKey && l.status === 'success')) return null;

  const newLog = {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    type: 'habit',
    specialKind: null,
    status: 'success',
    value: 1,
    igtDay: getIgtDayNumber(player),
    loggedDate: todayKey,
    loggedAt: new Date().toISOString(),
  };
  await db.add(STORES.eventLog, newLog);

  // Recompute streak from the cross-profile set with the fresh log included.
  const streak = computeHabitStreakFromLogs([...allLogs, newLog], todayKey);
  const multiplierValue = computeHabitMultiplier(streak, customEvent.maxBonusPct);
  return replaceBuffForEvent(db, player, customEvent, multiplierValue, 'habit', customEvent.name);
}

// ── Quantity log (called from detail page) ──────────────────────────────
export async function logQuantity(db, player, customEvent, count = 1) {
  if (!player || !customEvent || customEvent.type !== 'quantity') return null;
  const safeCount = Math.max(1, Math.floor(Number(count) || 0));
  const todayKey = getDateKey();

  await db.add(STORES.eventLog, {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    type: 'quantity',
    specialKind: null,
    status: 'success',
    value: safeCount,
    igtDay: getIgtDayNumber(player),
    loggedDate: todayKey,
    loggedAt: new Date().toISOString(),
  });

  // Cross-profile aggregation: today's total includes contributions from
  // every profile, so the human's actions all roll up into one buff.
  const all = await db.getEventLogsForEvent(customEvent.UUID);
  const todayTotal = all
    .filter((l) => getLogDateKey(l) === todayKey && l.status === 'success')
    .reduce((acc, l) => acc + (Number(l.value) || 0), 0);

  const multiplierValue = computeQuantityMultiplier(todayTotal, customEvent.dailyTarget, customEvent.maxBonusPct);
  return replaceBuffForEvent(db, player, customEvent, multiplierValue, 'quantity', customEvent.name);
}

// ── Wake-time event ─────────────────────────────────────────────────────
export async function applyWakeTimeBuff(db, player, deltaMs) {
  if (!player) return null;
  const safeDelta = Math.max(0, Number(deltaMs) || 0);
  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.wakeTime);
  if (!customEvent) return null;

  await db.add(STORES.eventLog, {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    type: 'special',
    specialKind: SPECIAL_KIND.wake_time,
    status: 'success',
    value: safeDelta,
    igtDay: getIgtDayNumber(player),
    loggedDate: getDateKey(),
    loggedAt: new Date().toISOString(),
  });

  const multiplierValue = computeWakeTimeMultiplier(safeDelta);
  return replaceBuffForEvent(db, player, customEvent, multiplierValue, 'special', customEvent.name);
}

// ── First-match event ───────────────────────────────────────────────────
/**
 * Cross-profile dedup: any profile already firing first-match today blocks
 * this from firing again. The "first match" of the human's day is what we
 * track, not the first match of the active save file.
 */
export async function shouldFireFirstMatch(db, player) {
  if (!player) return false;
  const todayKey = getDateKey();
  const logs = await db.getEventLogsForEvent(SPECIAL_EVENT_IDS.firstMatch);
  return !logs.some((l) => getLogDateKey(l) === todayKey);
}

export async function applyFirstMatchBuff(db, player, deltaMs) {
  if (!player) return null;
  const safeDelta = Math.max(0, Number(deltaMs) || 0);
  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.firstMatch);
  if (!customEvent) return null;

  await db.add(STORES.eventLog, {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    type: 'special',
    specialKind: SPECIAL_KIND.first_match,
    status: 'success',
    value: safeDelta,
    igtDay: getIgtDayNumber(player),
    loggedDate: getDateKey(),
    loggedAt: new Date().toISOString(),
  });

  const multiplierValue = computeFirstMatchMultiplier(safeDelta);
  return replaceBuffForEvent(db, player, customEvent, multiplierValue, 'special', customEvent.name);
}

/**
 * Convenience: caller passes when the match was started; we look up the
 * player's wake-confirm timestamp and compute the delta.
 */
export async function fireFirstMatchIfDue(db, player, matchStartedAtMs = Date.now()) {
  if (!(await shouldFireFirstMatch(db, player))) return null;
  const wakeAt = player?.wakeConfirmedAt ? new Date(player.wakeConfirmedAt).getTime() : null;
  const delta = wakeAt ? Math.max(0, matchStartedAtMs - wakeAt) : 0;
  return applyFirstMatchBuff(db, player, delta);
}

// ── Entertainment / Work Discipline ─────────────────────────────────────
/**
 * Idempotent for a single calendar day across all profiles. Inspects
 * item_use events between the last wake event and "now". If no entertainment
 * was used, fires the buff and logs success. Otherwise logs failure (no
 * penalty, just an ✕ on the timeline).
 */
export async function checkEntertainmentAndLog(db, player) {
  if (!player) return null;
  const todayKey = getDateKey();
  const existingLogs = await db.getEventLogsForEvent(SPECIAL_EVENT_IDS.entertainment);
  if (existingLogs.some((l) => getLogDateKey(l) === todayKey)) return null;

  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.entertainment);
  if (!customEvent) return null;

  const lastWake = await db.getLastEventType([EVENT.wake], player.UUID);
  const wakeAt = lastWake ? new Date(lastWake.createdAt).getTime() : 0;

  const events = await db.getPlayerStore(STORES.event, player.UUID);
  const itemUses = events.filter((e) => {
    if (e.type !== EVENT.item_use) return false;
    const t = new Date(e.createdAt).getTime();
    return Number.isFinite(t) && t >= wakeAt;
  });
  const usedEntertainment = itemUses.some((e) => (e.category || '').toLowerCase() === 'entertainment');

  await db.add(STORES.eventLog, {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    type: 'special',
    specialKind: SPECIAL_KIND.entertainment,
    status: usedEntertainment ? 'failure' : 'success',
    value: 0,
    igtDay: getIgtDayNumber(player),
    loggedDate: todayKey,
    loggedAt: new Date().toISOString(),
  });

  if (!usedEntertainment) {
    return replaceBuffForEvent(db, player, customEvent, computeEntertainmentMultiplier(), 'special', customEvent.name);
  }
  return null;
}

// ── Wake-time delta helper ──────────────────────────────────────────────
/**
 * How many ms the player is relative to their wake time when they confirm
 * ENTER DAY.
 *
 *  positive  →  late  (confirmed N ms after the wake target)
 *  negative  →  early (confirmed N ms before the wake target)
 *  0         →  exactly on time
 *
 * The tricky case: if it's 11 pm and wakeTime is 7 am, naïvely computing
 * against *today's* 7 am gives +16 h ("16 h late"), when the player is
 * actually 8 h *before* tomorrow's 7 am.  We detect this by checking
 * whether more than 12 hours have elapsed since today's wake time — if so,
 * we're in the evening-into-next-day window and should reference tomorrow.
 */
export function computeWakeDelta(wakeTime, confirmedAtMs = Date.now()) {
  const todayTarget = getWakeDateForDate(wakeTime, new Date(confirmedAtMs));
  if (!todayTarget) return 0;

  const rawDelta = confirmedAtMs - todayTarget.getTime();

  // More than 12 h past today's wake ⟹ evening / pre-sleep window.
  // Reference tomorrow's wake time so the display reads "N h early".
  if (rawDelta > 12 * 60 * 60 * 1000) {
    const tomorrowTarget = new Date(todayTarget);
    tomorrowTarget.setDate(tomorrowTarget.getDate() + 1);
    return confirmedAtMs - tomorrowTarget.getTime(); // negative = early
  }

  return rawDelta;
}