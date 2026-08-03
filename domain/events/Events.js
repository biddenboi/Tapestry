import { v4 as uuid } from 'uuid';
import {
  EVENT, STORES, SPECIAL_EVENT_IDS, SPECIAL_KIND, SPECIAL_EVENT_TUNING,
  HABIT_STREAK_CAP_DAYS, DAY,
} from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';

// ─── Internal write helpers ─────────────────────────────────────────────

async function queueEventAchievement(db, event, context = {}) {
  if (!event?.parent || !db) return;
  if (db.ensureDomainLoaded) await db.ensureDomainLoaded('achievements');
  await queueAchievementEvent(db, event, context);
}

async function writeEventLog(db, log, achievementContext = {}) {
  await db.add(STORES.eventLog, log);
  await queueEventAchievement(db, createAchievementEvent({
    type: ACHIEVEMENT_EVENT_TYPE.eventLogged,
    parent: log.parent,
    sourceUUID: log.UUID,
    occurredAt: log.loggedAt || log.createdAt,
    payload: {
      isNew: true,
      fellowshipContribution: log.specialKind === SPECIAL_KIND.sleep_time && log.status === 'success'
        ? Math.max(0, (Number(log.multiplierValue) || 1) - 1)
        : 0,
    },
  }), achievementContext);
  return log;
}

async function writeEvent(db, player, type, description, createdAt = new Date().toISOString(), achievementContext = {}) {
  if (!player) return null;
  const entry = { UUID: uuid(), parent: player.UUID, type, description, createdAt };
  await db.add(STORES.event, entry);
  await queueEventAchievement(db, createAchievementEvent({
    type: ACHIEVEMENT_EVENT_TYPE.timelineEventCreated,
    parent: player.UUID,
    sourceUUID: entry.UUID,
    occurredAt: createdAt,
    payload: { isNew: true },
  }), achievementContext);
  return entry;
}

function getBuffExpiry(player) {
  const sleepDate = getSleepDateForDate(player?.sleepTime, new Date());
  if (sleepDate && sleepDate.getTime() > Date.now()) return sleepDate.toISOString();
  const eod = new Date();
  eod.setHours(23, 59, 59, 999);
  return eod.toISOString();
}

async function replaceBuffForEvent(db, player, customEvent, multiplierValue, source, options = {}) {
  if (!player || !customEvent) return null;
  const existing = await db.getPlayerStore(STORES.eventBuff, player.UUID);
  for (const b of existing.filter((x) => x.eventUUID === customEvent.UUID)) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.eventBuff, b.UUID);
  }
  const entry = {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    label: customEvent.name,
    multiplierValue,
    source,
    appliedAt: new Date().toISOString(),
    expiresAt: Object.hasOwn(options, 'expiresAt') ? options.expiresAt : getBuffExpiry(player),
    ...(options.metadata || {}),
  };
  await db.add(STORES.eventBuff, entry);
  return entry;
}

async function clearDayScopedEventBuffs(db, playerUUID) {
  if (!db || !playerUUID) return;
  const all = await db.getPlayerStore(STORES.eventBuff, playerUUID);
  for (const b of all.filter((x) => x.eventUUID !== SPECIAL_EVENT_IDS.dojoMultiplier)) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.eventBuff, b.UUID);
  }
}

function makeEventLog(player, customEvent, type, specialKind, status, value, extra = {}) {
  return {
    UUID: uuid(),
    parent: player.UUID,
    eventUUID: customEvent.UUID,
    type,
    specialKind,
    status,
    value,
    igtDay: getIgtDayNumber(player),
    loggedDate: getDateKey(),
    loggedAt: new Date().toISOString(),
    inGameTimestamp: getCurrentIGT(player),
    ...extra,
  };
}

// ─── IGT / date utilities ───────────────────────────────────────────────

export function getIgtDayNumber(player) {
  return Math.floor(getCurrentIGT(player) / DAY);
}

export function getDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getLogDateKey(log) {
  if (!log) return null;
  return log.loggedDate || (log.loggedAt ? getDateKey(log.loggedAt) : null);
}

export function shiftDateKey(key, deltaDays) {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return getDateKey(d);
}

// ─── Sleep-time helpers ─────────────────────────────────────────────────

export function getSleepDateForDate(sleepTime, baseDate = new Date()) {
  if (!sleepTime) return null;
  const [h, m] = sleepTime.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

export const getSleepDateToday = (sleepTime) => getSleepDateForDate(sleepTime, new Date());

export function getBackfilledSleepDate(sleepTime, dayToClose = new Date()) {
  return getSleepDateForDate(sleepTime, dayToClose) || (() => {
    const d = new Date(dayToClose);
    d.setHours(23, 59, 59, 999);
    return d;
  })();
}

export function normalizeRitualChecklist(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return rows
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function getClosestScheduledDate(time, atMs = Date.now()) {
  const base = new Date(atMs);
  const target = getSleepDateForDate(time, base);
  if (!target) return null;
  const candidates = [-1, 0, 1].map((offset) => {
    const candidate = new Date(target);
    candidate.setDate(candidate.getDate() + offset);
    return candidate;
  });
  return candidates.reduce((best, candidate) => (
    Math.abs(candidate.getTime() - atMs) < Math.abs(best.getTime() - atMs) ? candidate : best
  ));
}

export function computeScheduledDelta(time, atMs = Date.now()) {
  const target = getClosestScheduledDate(time, atMs);
  return target ? atMs - target.getTime() : 0;
}

export const computeSleepDelta = (sleepTime, confirmedAtMs = Date.now()) => (
  computeScheduledDelta(sleepTime, confirmedAtMs)
);

// ─── Day boundaries ─────────────────────────────────────────────────────

export async function startDay(db, player) {
  if (!player) return;
  await db.add(STORES.player, { ...player, minutesClearedToday: 0 });
  await writeEvent(db, player, EVENT.wake, 'Started the day');
  // Clear day-scoped buffs only. Dojo Momentum is match-scoped and must
  // survive day transitions until this profile's next match concludes.
  try { await clearDayScopedEventBuffs(db, player.UUID); } catch { /* non-fatal */ }
  try { await checkHabitFailures(db, player); } catch { /* non-fatal */ }
  try { await refreshReverseEventBuffs(db, player); } catch { /* non-fatal */ }
}

export async function endWorkDay(db, player) {
  if (!player) return;
  await writeEvent(db, player, EVENT.end_work, 'Ended work day');
}

export async function endDay(
  db,
  player,
  loseAll = false,
  createdAt = new Date().toISOString(),
  ritual = {},
) {
  if (!player) return;
  const newTokens = loseAll ? 0 : (player.tokens || 0);
  const description = loseAll ? 'Sleep time passed — all tokens forfeited' : 'Day ended — tokens preserved';
  const updatedPlayer = { ...player, tokens: newTokens };
  await db.add(STORES.player, updatedPlayer);
  const achievementContext = ritual.achievementContext || {};
  await writeEvent(db, player, EVENT.sleep, description, createdAt, achievementContext);
  const checklist = normalizeRitualChecklist(ritual.checklistItems);
  const checkedItems = normalizeRitualChecklist(ritual.checkedItems);
  const confirmedAt = new Date(createdAt).getTime();
  const deltaMs = computeSleepDelta(
    player.sleepTime || '23:00',
    Number.isFinite(confirmedAt) ? confirmedAt : Date.now(),
  );
  try {
    await recordSleepTimeResult(
      db,
      updatedPlayer,
      deltaMs,
      checkedItems.length,
      checklist.length,
      checkedItems,
      { eligible: !loseAll, loggedAt: createdAt, achievementContext },
    );
  } catch { /* non-fatal */ }
  // Idempotent — finalize entertainment buff if work day was never explicitly ended.
  try { await checkEntertainmentAndLog(db, player, achievementContext); } catch { /* non-fatal */ }
}

export async function pruneFutureDayEvents(db, playerUUID) {
  if (!db || !playerUUID) return 0;
  const events = await db.getPlayerStore(STORES.event, playerUUID);
  if (!events?.length) return 0;
  events.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const now = Date.now();
  const toDelete = [];
  for (const e of events) {
    const t = new Date(e.createdAt).getTime();
    if (Number.isFinite(t) && t > now) {
      if (e.type === EVENT.wake || e.type === EVENT.sleep) toDelete.push(e.UUID);
    } else break;
  }
  for (const id of toDelete) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.event, id);
  }
  return toDelete.length;
}

// ─── Buff/debuff classification ─────────────────────────────────────────
// Negative maxBonusPct = debuff. For HABITS that also flips log semantics
// (no-log = success, tap = "I slipped"). For QUANTITY events, the `reverse`
// flag (independent of sign) inverts progression.

export const isEventDebuff = (e) => Number(e?.maxBonusPct) < 0;

export function isReverseEvent(e) {
  if (!e) return false;
  if (e.type === 'habit') return Number(e.maxBonusPct) < 0;
  if (e.type === 'quantity') return !!e.reverse;
  return false;
}

// ─── Multiplier formulas ────────────────────────────────────────────────
// 1.0 = no effect, 1.2 = +20% buff, 0.8 = −20% debuff.

export function computeHabitMultiplier(streak, maxBonusPct) {
  const ratio = Math.min(Math.max(0, Number(streak) || 0), HABIT_STREAK_CAP_DAYS) / HABIT_STREAK_CAP_DAYS;
  const bonus = (Number(maxBonusPct) || 0) / 100;
  // Reverse habit: at full clean streak the debuff has decayed to nothing.
  return bonus < 0 ? 1 + bonus * (1 - ratio) : 1 + bonus * ratio;
}

export function computeQuantityMultiplier(todayTotal, dailyTarget, maxBonusPct, reverse = false) {
  const target = Math.max(1, Number(dailyTarget) || 1);
  const ratio = Math.min(Math.max(0, Number(todayTotal) || 0) / target, 1);
  const bonus = (Number(maxBonusPct) || 0) / 100;
  // Reverse buff: starts at max, decays toward 1 as logs accumulate.
  if (reverse && bonus > 0) return 1 + bonus * (1 - ratio);
  return 1 + bonus * ratio;
}

const expDecayMultiplier = (deltaMs, key) => {
  const { ceiling, decayMs } = SPECIAL_EVENT_TUNING[key];
  return 1 + ceiling * Math.exp(-Math.max(0, Number(deltaMs) || 0) / decayMs);
};

export function computeRitualMultiplier(deltaMs, completedCount = 0, totalCount = 0, key = 'wake_time') {
  const tuning = SPECIAL_EVENT_TUNING[key] || SPECIAL_EVENT_TUNING.wake_time;
  const total = Math.max(0, Number(totalCount) || 0);
  const completed = Math.min(total, Math.max(0, Number(completedCount) || 0));
  const checklistRatio = total > 0 ? completed / total : 0;
  const timingBonus = tuning.timingCeiling
    * Math.exp(-Math.abs(Number(deltaMs) || 0) / tuning.decayMs);
  return 1 + timingBonus + (tuning.checklistCeiling * checklistRatio);
}

export const computeWakeTimeMultiplier = (deltaMs, completedCount = 0, totalCount = 0) => (
  computeRitualMultiplier(deltaMs, completedCount, totalCount, 'wake_time')
);
export const computeSleepTimeMultiplier = (deltaMs, completedCount = 0, totalCount = 0) => (
  computeRitualMultiplier(deltaMs, completedCount, totalCount, 'sleep_time')
);
export const computeFirstMatchMultiplier = (deltaMs) => expDecayMultiplier(deltaMs, 'first_match');
export const computeEntertainmentMultiplier = () => 1 + SPECIAL_EVENT_TUNING.entertainment.flatBonus;

// ─── Habit streak (cross-profile, by calendar date) ─────────────────────

export function computeHabitStreakFromLogs(logs, todayKey = getDateKey()) {
  const success = new Set();
  for (const l of logs || []) {
    if (l?.status !== 'success') continue;
    const k = getLogDateKey(l);
    if (k) success.add(k);
  }
  if (!success.size) return 0;

  let cursor = success.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  for (let i = 0; i < 365 * 5; i += 1) {
    if (!success.has(cursor)) break;
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

// ─── Reverse-event passive seeding (start of day) ───────────────────────

export async function refreshReverseEventBuffs(db, player) {
  if (!player) return;
  const all = await db.getAllCustomEvents();
  const todayKey = getDateKey();
  const viewerIGT = getCurrentIGT(player);

  for (const e of all) {
    const isReverseHabit = e.type === 'habit' && Number(e.maxBonusPct) < 0;
    const isReverseQty = e.type === 'quantity' && e.reverse && Number(e.maxBonusPct) > 0;
    if (!isReverseHabit && !isReverseQty) continue;

    // eslint-disable-next-line no-await-in-loop
    const logs = await db.getEventLogsForEventThroughIGT(e.UUID, viewerIGT);
    let mv;
    if (isReverseHabit) {
      mv = computeHabitMultiplier(computeHabitStreakFromLogs(logs, todayKey), e.maxBonusPct);
    } else {
      const today = logs.filter((l) => getLogDateKey(l) === todayKey && l.status === 'success')
        .reduce((acc, l) => acc + (Number(l.value) || 0), 0);
      mv = computeQuantityMultiplier(today, e.dailyTarget, e.maxBonusPct, true);
    }
    if (Math.abs(mv - 1) > 1e-9) {
      // eslint-disable-next-line no-await-in-loop
      await replaceBuffForEvent(db, player, e, mv, isReverseHabit ? 'habit' : 'quantity');
    }
  }
}

// ─── Habit failure backfill ─────────────────────────────────────────────
// Cross-profile-aware. Normal habits: missing day = failure. Reverse: missing = success.

export async function checkHabitFailures(db, player) {
  if (!player) return;
  const habits = (await db.getAllCustomEvents()).filter((e) => e.type === 'habit');
  if (!habits.length) return;
  const todayKey = getDateKey();
  const viewerIGT = getCurrentIGT(player);

  for (const h of habits) {
    const backfillStatus = Number(h.maxBonusPct) < 0 ? 'success' : 'failure';
    // eslint-disable-next-line no-await-in-loop
    const logs = await db.getEventLogsForEventThroughIGT(h.UUID, viewerIGT);
    const loggedKeys = new Set(logs.map(getLogDateKey).filter(Boolean));

    let earliest = todayKey;
    for (const k of loggedKeys) if (k && k < earliest) earliest = k;
    const ninetyAgo = shiftDateKey(todayKey, -90);
    if (earliest < ninetyAgo) earliest = ninetyAgo;

    let cursor = earliest;
    while (cursor < todayKey) {
      if (!loggedKeys.has(cursor)) {
        // eslint-disable-next-line no-await-in-loop
        await writeEventLog(db, {
          UUID: uuid(),
          parent: player.UUID,
          eventUUID: h.UUID,
          type: 'habit',
          specialKind: null,
          status: backfillStatus,
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

// ─── User-driven event logs ─────────────────────────────────────────────

/**
 * Habit check-in. Normal habits: tap = success. Reverse habits: tap = "slipped"
 * (failure log; clean days backfill as success). One log per calendar day per
 * event across all profiles.
 */
export async function checkInHabit(db, player, customEvent) {
  if (!player || !customEvent || customEvent.type !== 'habit') return null;
  const todayKey = getDateKey();
  const allLogs = await db.getEventLogsForEventThroughIGT(customEvent.UUID, getCurrentIGT(player));
  if (allLogs.some((l) => getLogDateKey(l) === todayKey)) return null;

  const status = Number(customEvent.maxBonusPct) < 0 ? 'failure' : 'success';
  const newLog = makeEventLog(player, customEvent, 'habit', null, status, 1);
  await writeEventLog(db, newLog);

  const streak = computeHabitStreakFromLogs([...allLogs, newLog], todayKey);
  const mv = computeHabitMultiplier(streak, customEvent.maxBonusPct);
  return replaceBuffForEvent(db, player, customEvent, mv, 'habit');
}

export async function logQuantity(db, player, customEvent, count = 1) {
  if (!player || !customEvent || customEvent.type !== 'quantity') return null;
  const safe = Math.max(1, Math.floor(Number(count) || 0));

  await writeEventLog(db, makeEventLog(player, customEvent, 'quantity', null, 'success', safe));

  const todayKey = getDateKey();
  const all = await db.getEventLogsForEventThroughIGT(customEvent.UUID, getCurrentIGT(player));
  const todayTotal = all
    .filter((l) => getLogDateKey(l) === todayKey && l.status === 'success')
    .reduce((acc, l) => acc + (Number(l.value) || 0), 0);

  const mv = computeQuantityMultiplier(todayTotal, customEvent.dailyTarget, customEvent.maxBonusPct, !!customEvent.reverse);
  return replaceBuffForEvent(db, player, customEvent, mv, 'quantity');
}

// ─── Special events (wake-time / first-match / entertainment) ───────────

async function applySpecialBuff(db, player, specialId, specialKind, value, multiplierValue, details = {}) {
  const customEvent = await db.get(STORES.customEvent, specialId);
  if (!customEvent) return null;
  await writeEventLog(db,
    makeEventLog(player, customEvent, 'special', specialKind, 'success', value, {
      multiplierValue,
      ...details,
    })
  );
  return replaceBuffForEvent(db, player, customEvent, multiplierValue, 'special');
}

export async function applyWakeTimeBuff(db, player, deltaMs, completedCount = 0, totalCount = 0, checkedItems = []) {
  if (!player) return null;
  const safe = Number(deltaMs) || 0;
  const multiplierValue = computeWakeTimeMultiplier(safe, completedCount, totalCount);
  return applySpecialBuff(
    db,
    player,
    SPECIAL_EVENT_IDS.wakeTime,
    SPECIAL_KIND.wake_time,
    Math.abs(safe),
    multiplierValue,
    {
      signedDeltaMs: safe,
      checklistCompleted: completedCount,
      checklistTotal: totalCount,
      checkedItems,
    },
  );
}

export async function applyFirstMatchBuff(db, player, deltaMs) {
  if (!player) return null;
  const safe = Math.max(0, Number(deltaMs) || 0);
  return applySpecialBuff(db, player, SPECIAL_EVENT_IDS.firstMatch, SPECIAL_KIND.first_match, safe, computeFirstMatchMultiplier(safe));
}

/** Cross-profile dedup: any profile firing first-match today blocks others. */
export async function shouldFireFirstMatch(db, player) {
  if (!player) return false;
  const todayKey = getDateKey();
  const logs = await db.getEventLogsForEventThroughIGT(
    SPECIAL_EVENT_IDS.firstMatch,
    getCurrentIGT(player),
  );
  return !logs.some((l) => getLogDateKey(l) === todayKey);
}

export async function fireFirstMatchIfDue(db, player, matchStartedAtMs = Date.now()) {
  if (!(await shouldFireFirstMatch(db, player))) return null;
  const wakeAt = player?.wakeConfirmedAt ? new Date(player.wakeConfirmedAt).getTime() : null;
  return applyFirstMatchBuff(db, player, wakeAt ? Math.max(0, matchStartedAtMs - wakeAt) : 0);
}

/**
 * Idempotent per calendar day across all profiles. If no entertainment item
 * was used since the last wake event, fires the buff and logs success;
 * otherwise logs failure (no penalty, just an ✕ on the timeline).
 */
export async function checkEntertainmentAndLog(db, player, achievementContext = {}) {
  if (!player) return null;
  const todayKey = getDateKey();
  const viewerIGT = getCurrentIGT(player);
  const existingLogs = await db.getEventLogsForEventThroughIGT(
    SPECIAL_EVENT_IDS.entertainment,
    viewerIGT,
  );
  if (existingLogs.some((l) => getLogDateKey(l) === todayKey)) return null;

  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.entertainment);
  if (!customEvent) return null;

  const lastWake = await db.getLastEventType([EVENT.wake], player.UUID);
  const wakeAt = lastWake ? new Date(lastWake.createdAt).getTime() : 0;

  const events = await db.getPlayerStoreThroughIGT(STORES.event, player.UUID, viewerIGT);
  const usedEntertainment = events.some((e) => {
    if (e.type !== EVENT.item_use) return false;
    const t = new Date(e.createdAt).getTime();
    return Number.isFinite(t) && t >= wakeAt && (e.category || '').toLowerCase() === 'entertainment';
  });

  await writeEventLog(
    db,
    makeEventLog(player, customEvent, 'special', SPECIAL_KIND.entertainment, usedEntertainment ? 'failure' : 'success', 0),
    achievementContext,
  );

  if (!usedEntertainment) {
    return replaceBuffForEvent(db, player, customEvent, computeEntertainmentMultiplier(), 'special');
  }
  return null;
}

// ─── Wake delta helper ──────────────────────────────────────────────────
/**
 * ms relative to wakeTime when the player confirms ENTER DAY:
 *   positive = late, negative = early. Handles the evening-into-next-day
 *   case so 11pm before a 7am wake reads as "8h early", not "16h late".
 */
export function computeWakeDelta(wakeTime, confirmedAtMs = Date.now()) {
  return computeScheduledDelta(wakeTime, confirmedAtMs);
}

export async function recordSleepTimeResult(
  db,
  player,
  deltaMs,
  completedCount = 0,
  totalCount = 0,
  checkedItems = [],
  { eligible = true, loggedAt = new Date().toISOString(), achievementContext = {} } = {},
) {
  if (!player) return null;
  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.sleepTime);
  if (!customEvent) return null;
  const safeDelta = Number(deltaMs) || 0;
  const multiplierValue = eligible
    ? computeSleepTimeMultiplier(safeDelta, completedCount, totalCount)
    : 1;
  const log = makeEventLog(
    player,
    customEvent,
    'special',
    SPECIAL_KIND.sleep_time,
    eligible ? 'success' : 'failure',
    Math.abs(safeDelta),
    {
      loggedAt,
      loggedDate: getDateKey(loggedAt),
      signedDeltaMs: safeDelta,
      multiplierValue,
      checklistCompleted: completedCount,
      checklistTotal: totalCount,
      checkedItems,
    },
  );
  await writeEventLog(db, log, achievementContext);

  if (eligible && multiplierValue > 1) {
    const freshPlayer = await db.get(STORES.player, player.UUID) || player;
    await db.add(STORES.player, {
      ...freshPlayer,
      pendingSleepReward: {
        sourcePlayerUUID: player.UUID,
        sourceUsername: player.username || '',
        multiplierValue,
        sleepAt: loggedAt,
        eventLogUUID: log.UUID,
      },
    });
  }
  return { log, multiplierValue };
}

export async function prepareNextProfileAfterSleep(db, sourcePlayerUUID, targetPlayerUUID) {
  if (!sourcePlayerUUID || !targetPlayerUUID) return null;
  const source = await db.get(STORES.player, sourcePlayerUUID);
  const target = sourcePlayerUUID === targetPlayerUUID
    ? source
    : await db.get(STORES.player, targetPlayerUUID);
  if (!target) return null;

  const reward = source?.pendingSleepReward || null;
  if (sourcePlayerUUID === targetPlayerUUID) {
    const updated = { ...target };
    delete updated.pendingSleepReward;
    if (reward) updated.pendingIncomingSleepReward = reward;
    await db.add(STORES.player, updated);
  } else {
    if (source) {
      const updatedSource = { ...source };
      delete updatedSource.pendingSleepReward;
      await db.add(STORES.player, updatedSource);
    }
    if (reward) {
      await db.add(STORES.player, { ...target, pendingIncomingSleepReward: reward });
    }
  }

  return (await db.get(STORES.player, targetPlayerUUID)) || target;
}

export async function applyPendingSleepTimeBuff(db, player) {
  if (!player?.UUID) return null;
  const freshPlayer = await db.get(STORES.player, player.UUID) || player;
  const reward = freshPlayer.pendingIncomingSleepReward;
  if (!reward) return null;
  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.sleepTime);
  if (!customEvent) return null;

  const buff = await replaceBuffForEvent(
    db,
    freshPlayer,
    customEvent,
    Number(reward.multiplierValue) || 1,
    'sleep-transfer',
    {
      sourcePlayerUUID: reward.sourcePlayerUUID,
      sourceUsername: reward.sourceUsername,
    },
  );
  const updated = { ...freshPlayer };
  delete updated.pendingIncomingSleepReward;
  await db.add(STORES.player, updated);
  return buff;
}

// ─── Dojo multiplier ────────────────────────────────────────────────────
// The dojo-multiplier buff is an accumulator, not a decay-curve special.
// Each completed dojo task contributes (taskWeight × hoursWorked) to the
// additive delta. The accumulated buff persists across dojo exits and is
// spent on (and cleared by) the next match conclude. While in dojo, the
// buff is filtered out of the live points calculation so it doesn't compound
// onto subsequent dojo tasks within the same session — see TaskSessionMenu.

/**
 * Add to the player's accumulated dojo multiplier.
 *
 *   contribution = taskWeight × hoursWorked
 *
 * where taskWeight is the existing aversion×urgency×commitment task multiplier
 * (the same number labeled "task" in the session UI breakdown) and hoursWorked
 * is `actualDurationMs / HOUR`. The contribution is added to the buff's current
 * additive delta — i.e. if the buff is currently 1 + a and we add c, the new
 * buff is 1 + a + c. Returns the new buff entry, or null if no contribution
 * was applied (zero/negative duration or weight).
 *
 * Also writes an event-log row for auditing and "earned today" summaries.
 */
export async function applyDojoContribution(db, player, taskWeight, durationMs, {
  completionEventUUID = null,
} = {}) {
  if (!player) return null;
  const customEvent = await db.get(STORES.customEvent, SPECIAL_EVENT_IDS.dojoMultiplier);
  if (!customEvent) return null;

  const hours = Math.max(0, Number(durationMs) || 0) / (60 * 60 * 1000);
  const weight = Math.max(0, Number(taskWeight) || 0);
  const delta = weight * hours;
  if (delta <= 0) return null;

  const existing = (await db.getPlayerStore(STORES.eventBuff, player.UUID))
    .filter((buff) => buff.eventUUID === SPECIAL_EVENT_IDS.dojoMultiplier);
  const currentBuff = existing[0] || null;
  const appliedCompletionEventUUIDs = Array.isArray(currentBuff?.appliedCompletionEventUUIDs)
    ? currentBuff.appliedCompletionEventUUIDs
    : [];
  const logUUID = completionEventUUID
    ? `task-completion:${completionEventUUID}:dojo-log`
    : null;

  // The accumulated buff records every completion event already applied. That
  // makes replay safe even if the process stopped after the buff write but
  // before its audit log or processor receipt was written.
  if (completionEventUUID && appliedCompletionEventUUIDs.includes(completionEventUUID)) {
    if (logUUID && !(await db.get(STORES.eventLog, logUUID))) {
      await writeEventLog(db, {
        ...makeEventLog(
          player,
          customEvent,
          'special',
          SPECIAL_KIND.dojo_multiplier,
          'success',
          delta,
          { completionEventUUID },
        ),
        UUID: logUUID,
      });
    }
    return currentBuff;
  }

  const current = currentBuff ? Number(currentBuff.multiplierValue) || 1 : 1;
  const next = current + delta;
  const buff = await replaceBuffForEvent(db, player, customEvent, next, 'dojo', {
    expiresAt: null,
    metadata: completionEventUUID ? {
      appliedCompletionEventUUIDs: [...appliedCompletionEventUUIDs, completionEventUUID],
    } : {},
  });

  const log = makeEventLog(
    player,
    customEvent,
    'special',
    SPECIAL_KIND.dojo_multiplier,
    'success',
    delta,
    completionEventUUID ? { completionEventUUID } : {},
  );
  if (logUUID) log.UUID = logUUID;
  await writeEventLog(db, log);
  return buff;
}

/** Wipe the player's dojo multiplier buff. Called from match conclude
 *  regardless of outcome — the match happened, the multiplier was applied
 *  (per the live-buff sum at task-submit time during the match), so it
 *  gets wiped. */
export async function clearDojoMultiplier(db, playerUUID) {
  if (!db || !playerUUID) return;
  const all = await db.getPlayerStore(STORES.eventBuff, playerUUID);
  for (const b of all.filter((x) => x.eventUUID === SPECIAL_EVENT_IDS.dojoMultiplier)) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.eventBuff, b.UUID);
  }
}
