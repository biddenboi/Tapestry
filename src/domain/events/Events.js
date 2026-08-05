import { v4 as uuid } from 'uuid';
import {
  EVENT, STORES, SPECIAL_EVENT_IDS, SPECIAL_KIND, SPECIAL_EVENT_TUNING, DAY,
} from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { recordLinkedActionContribution } from '@domain/goals/GoalEvidence.js';
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
      fellowshipContribution: 0,
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

function makeEventLog(player, customEvent, type, specialKind, status, value, extra = {}) {
  const loggedAt = new Date().toISOString();
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
    loggedAt,
    createdAt: loggedAt,
    inGameTimestamp: getCurrentIGT(player),
    trackingEraId: customEvent.currentEraId || null,
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
  const newTokens = player.tokens || 0;
  const description = 'Day ended — timing saved as historical context';
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
  let sleepResult = null;
  try {
    sleepResult = await recordSleepTimeResult(
      db,
      updatedPlayer,
      deltaMs,
      checkedItems.length,
      checklist.length,
      checkedItems,
      { eligible: true, loggedAt: createdAt, achievementContext },
    );
  } catch { /* non-fatal */ }
  // Idempotent — finalize the entertainment-day log if work day was never explicitly ended.
  try { await checkEntertainmentAndLog(db, player, achievementContext); } catch { /* non-fatal */ }
  return { updatedPlayer, sleepResult };
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
  if (e.type === 'one_time') return Number(e.maxBonusPct) < 0;
  if (e.type === 'quantity') return !!e.reverse;
  return false;
}

// ─── Multiplier formulas ────────────────────────────────────────────────
// 1.0 = no effect, 1.2 = +20% buff, 0.8 = −20% debuff.

export function computeHabitMultiplier(streak, maxBonusPct) {
  void streak;
  void maxBonusPct;
  return 1;
}

export function computeQuantityMultiplier(todayTotal, dailyTarget, maxBonusPct, reverse = false) {
  const target = Math.max(1, Number(dailyTarget) || 1);
  const ratio = Math.min(Math.max(0, Number(todayTotal) || 0) / target, 1);
  const bonus = (Number(maxBonusPct) || 0) / 100;
  // Reverse buff: starts at max, decays toward 1 as logs accumulate.
  if (reverse && bonus > 0) return 1 + bonus * (1 - ratio);
  return 1 + bonus * ratio;
}

export function computeRitualMultiplier(deltaMs, completedCount = 0, totalCount = 0, key = 'wake_time') {
  void deltaMs;
  void completedCount;
  void totalCount;
  void key;
  return 1;
}

export const computeWakeTimeMultiplier = (deltaMs, completedCount = 0, totalCount = 0) => (
  (void deltaMs, void completedCount, void totalCount, 1)
);
export const computeSleepTimeMultiplier = (deltaMs, completedCount = 0, totalCount = 0) => (
  (void deltaMs, void completedCount, void totalCount, 1)
);
export const computeFirstMatchMultiplier = (deltaMs) => (void deltaMs, 1);
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

// ─── User-driven event logs ─────────────────────────────────────────────

/**
 * One-time completion. One completion per local calendar day and tracking era
 * across all profiles.
 */
export async function completeOneTimeHabit(db, player, customEvent) {
  if (!player || !customEvent || customEvent.type !== 'one_time') return null;
  const todayKey = getDateKey();
  const viewerIGT = getCurrentIGT(player);
  const allLogs = await db.getEventLogsForEventThroughIGT(customEvent.UUID, viewerIGT);
  const eraLogs = allLogs.filter((log) => log.trackingEraId === customEvent.currentEraId);
  if (eraLogs.some((log) => log.status === 'success' && getLogDateKey(log) === todayKey)) return null;

  const newLog = makeEventLog(player, customEvent, 'one_time', null, 'success', 1, {
    action: 'complete',
  });
  await writeEventLog(db, newLog);
  const contribution = await recordLinkedActionContribution(db, player, {
    entityType: 'habit',
    entityUUID: customEvent.UUID,
    source: 'habit',
    sourceUUID: newLog.UUID,
    summary: customEvent.name || 'Event check-in',
    createdAt: newLog.loggedAt,
    inGameTimestamp: newLog.inGameTimestamp,
  });

  const streak = computeHabitStreakFromLogs([...eraLogs, newLog], todayKey);
  return { log: newLog, contribution, streak };
}

export async function logQuantity(db, player, customEvent, count = 1) {
  if (!player || !customEvent || customEvent.type !== 'quantity') return null;
  const safe = Math.max(1, Math.floor(Number(count) || 0));
  const log = makeEventLog(player, customEvent, 'quantity', null, 'success', safe, {
    action: 'add',
  });
  await writeEventLog(db, log);
  const contribution = await recordLinkedActionContribution(db, player, {
    entityType: 'habit',
    entityUUID: customEvent.UUID,
    source: 'quantity',
    sourceUUID: log.UUID,
    summary: customEvent.name || 'Quantity log',
    createdAt: log.loggedAt,
    inGameTimestamp: log.inGameTimestamp,
  });

  const todayKey = getDateKey();
  const all = await db.getEventLogsForEventThroughIGT(customEvent.UUID, getCurrentIGT(player));
  const todayTotal = all
    .filter((l) => l.trackingEraId === customEvent.currentEraId)
    .filter((l) => l.action === 'add' && getLogDateKey(l) === todayKey && l.status === 'success')
    .reduce((acc, l) => acc + (Number(l.value) || 0), 0);

  return { log, contribution, todayTotal };
}

export function findRunningDurationSession(logs = [], trackingEraId = null) {
  const stopped = new Set(
    logs
      .filter((log) => log?.action === 'stop' && log.sessionUUID)
      .map((log) => String(log.sessionUUID)),
  );
  return logs
    .filter((log) => log?.action === 'start' && log.sessionUUID)
    .filter((log) => !trackingEraId || log.trackingEraId === trackingEraId)
    .filter((log) => !stopped.has(String(log.sessionUUID)))
    .sort((left, right) => String(right.loggedAt || '').localeCompare(String(left.loggedAt || '')))[0] || null;
}

export function splitDurationSessionByDay(startedAt, stoppedAt) {
  const startMs = new Date(startedAt).getTime();
  const stopMs = new Date(stoppedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs <= startMs) return [];

  const segments = [];
  let cursor = startMs;
  while (cursor < stopMs) {
    const dayEnd = new Date(cursor);
    dayEnd.setHours(24, 0, 0, 0);
    const end = Math.min(stopMs, dayEnd.getTime());
    segments.push({
      loggedDate: getDateKey(new Date(cursor)),
      durationMs: Math.max(0, end - cursor),
    });
    cursor = end;
  }
  return segments;
}

export async function startDurationHabit(db, player, customEvent) {
  if (!player || !customEvent || customEvent.type !== 'duration') return null;
  const viewerIGT = getCurrentIGT(player);
  const allLogs = await db.getEventLogsForEventThroughIGT(customEvent.UUID, viewerIGT);
  if (findRunningDurationSession(allLogs, customEvent.currentEraId)) return null;

  const sessionUUID = uuid();
  const log = makeEventLog(player, customEvent, 'duration', null, 'started', 0, {
    action: 'start',
    sessionUUID,
  });
  await writeEventLog(db, log);
  return { log, sessionUUID };
}

export async function stopDurationHabit(db, player, customEvent) {
  if (!player || !customEvent || customEvent.type !== 'duration') return null;
  const viewerIGT = getCurrentIGT(player);
  const allLogs = await db.getEventLogsForEventThroughIGT(customEvent.UUID, viewerIGT);
  const started = findRunningDurationSession(allLogs, customEvent.currentEraId);
  if (!started) return null;

  const stoppedAt = new Date().toISOString();
  const durationMs = Math.max(0, new Date(stoppedAt).getTime() - new Date(started.loggedAt).getTime());
  const log = makeEventLog(player, customEvent, 'duration', null, 'success', durationMs, {
    action: 'stop',
    sessionUUID: started.sessionUUID,
    startedAt: started.loggedAt,
    stoppedAt,
    loggedAt: stoppedAt,
    loggedDate: getDateKey(new Date(stoppedAt)),
    segments: splitDurationSessionByDay(started.loggedAt, stoppedAt),
  });
  await writeEventLog(db, log);
  const contribution = await recordLinkedActionContribution(db, player, {
    entityType: 'habit',
    entityUUID: customEvent.UUID,
    source: 'duration',
    sourceUUID: log.UUID,
    summary: customEvent.name || 'Duration session',
    createdAt: stoppedAt,
    inGameTimestamp: log.inGameTimestamp,
  });
  return { log, contribution, durationMs };
}

// ─── Special events (wake-time / first-match / entertainment) ───────────

async function recordSpecialEventLog(db, player, specialId, specialKind, value, details = {}) {
  const customEvent = await db.get(STORES.customEvent, specialId);
  if (!customEvent) return null;
  const log = makeEventLog(player, customEvent, 'special', specialKind, 'success', value, details);
  await writeEventLog(db, log);
  return log;
}

export async function applyWakeTimeBuff(db, player, deltaMs, completedCount = 0, totalCount = 0, checkedItems = []) {
  if (!player) return null;
  const safe = Number(deltaMs) || 0;
  const log = await recordSpecialEventLog(
    db,
    player,
    SPECIAL_EVENT_IDS.wakeTime,
    SPECIAL_KIND.wake_time,
    Math.abs(safe),
    {
      signedDeltaMs: safe,
      checklistCompleted: completedCount,
      checklistTotal: totalCount,
      checkedItems,
    },
  );
  return { log, contribution: null, rewardPolicy: 'legacy-context-only' };
}

export async function applyFirstMatchBuff(db, player, deltaMs) {
  if (!player) return null;
  const safe = Math.max(0, Number(deltaMs) || 0);
  // First-match timing remains historical/social context only. The completed
  // match itself is the Contribution-bearing action; no multiplier is created.
  return recordSpecialEventLog(
    db,
    player,
    SPECIAL_EVENT_IDS.firstMatch,
    SPECIAL_KIND.first_match,
    safe,
  );
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

  const log = makeEventLog(
    player,
    customEvent,
    'special',
    SPECIAL_KIND.entertainment,
    usedEntertainment ? 'failure' : 'success',
    0,
  );
  await writeEventLog(db, log, achievementContext);
  return log;
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
  const safeDelta = Number(deltaMs) || 0;
  const log = customEvent ? makeEventLog(
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
      checklistCompleted: completedCount,
      checklistTotal: totalCount,
      checkedItems,
    },
  ) : null;
  if (log) await writeEventLog(db, log, achievementContext);

  return { log, contribution: null, rewardPolicy: 'legacy-context-only' };
}

export async function prepareNextProfileAfterSleep(db, sourcePlayerUUID, targetPlayerUUID) {
  if (!sourcePlayerUUID || !targetPlayerUUID) return null;
  return db.get(STORES.player, targetPlayerUUID);
}
