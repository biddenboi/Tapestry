import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';

function localDayWindow(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createRhythmDefinition({
  playerUUID,
  targetType = 'habit',
  targetUUID,
  cadenceType = 'daily',
  opportunitiesPerPeriod = null,
  eligibleWeekdays = [],
  minimumQuantity = null,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  activeFrom = new Date().toISOString(),
  activeUntil = null,
  streakVisible = false,
  UUID = uuid(),
} = {}) {
  if (!playerUUID || !targetUUID) throw new TypeError('A Rhythm requires a player and target.');
  return Object.freeze({
    UUID,
    parent: String(playerUUID),
    targetType,
    targetUUID: String(targetUUID),
    cadenceType,
    opportunitiesPerPeriod,
    eligibleWeekdays: [...eligibleWeekdays],
    minimumQuantity,
    timezone,
    activeFrom,
    activeUntil,
    streakVisible: Boolean(streakVisible),
    createdAt: activeFrom,
    updatedAt: activeFrom,
  });
}

export function opportunityWindows(rhythm, from, through) {
  const windows = [];
  const cursor = localDayWindow(from).start;
  const end = localDayWindow(through).end;
  const weeklyKeys = new Set();
  while (cursor < end) {
    const { start, end: windowEnd } = localDayWindow(cursor);
    const weekdayAllowed = !rhythm.eligibleWeekdays?.length
      || rhythm.eligibleWeekdays.includes(start.getDay());
    if (weekdayAllowed && ['daily', 'weekdays'].includes(rhythm.cadenceType)) {
      windows.push({ windowStart: start.toISOString(), windowEnd: windowEnd.toISOString() });
    }
    if (['times-per-week', 'duration-per-week'].includes(rhythm.cadenceType)) {
      const weekStart = new Date(start);
      const offset = (weekStart.getDay() + 6) % 7;
      weekStart.setDate(weekStart.getDate() - offset);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const key = weekStart.toISOString();
      if (!weeklyKeys.has(key)) {
        weeklyKeys.add(key);
        windows.push({ windowStart: key, windowEnd: weekEnd.toISOString() });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return windows;
}

export async function ensureRhythmForTracker(databaseConnection, player, tracker, now = new Date()) {
  if (!databaseConnection || !player?.UUID || !tracker?.UUID || tracker.type === 'special') return null;
  const definitions = await databaseConnection.getPlayerStore(STORES.rhythmDefinition, player.UUID);
  let rhythm = definitions.find((row) => (
    row.targetType === 'habit' && String(row.targetUUID) === String(tracker.UUID)
  ));
  const weekdays = Array.isArray(tracker.eligibleWeekdays) ? tracker.eligibleWeekdays : [];
  const desired = {
    cadenceType: tracker.rhythmCadenceType || (weekdays.length ? 'weekdays' : 'daily'),
    opportunitiesPerPeriod: tracker.opportunitiesPerPeriod || null,
    eligibleWeekdays: weekdays,
    minimumQuantity: tracker.dailyTarget || tracker.target || null,
    streakVisible: Boolean(tracker.streakVisible),
  };
  if (!rhythm) {
    rhythm = createRhythmDefinition({
      playerUUID: player.UUID,
      targetUUID: tracker.UUID,
      ...desired,
      activeFrom: tracker.createdAt || now.toISOString(),
    });
    await databaseConnection.add(STORES.rhythmDefinition, rhythm);
  } else if (
    rhythm.cadenceType !== desired.cadenceType
    || Number(rhythm.opportunitiesPerPeriod || 0) !== Number(desired.opportunitiesPerPeriod || 0)
    || JSON.stringify(rhythm.eligibleWeekdays || []) !== JSON.stringify(desired.eligibleWeekdays)
    || Number(rhythm.minimumQuantity || 0) !== Number(desired.minimumQuantity || 0)
    || Boolean(rhythm.streakVisible) !== desired.streakVisible
  ) {
    rhythm = {
      ...rhythm,
      ...desired,
      updatedAt: now.toISOString(),
    };
    await databaseConnection.add(STORES.rhythmDefinition, rhythm);
  }
  const existing = await databaseConnection.getPlayerStore(STORES.rhythmOpportunity, player.UUID);
  const existingKeys = new Set(existing
    .filter((row) => row.rhythmUUID === rhythm.UUID)
    .map((row) => `${row.windowStart}:${row.windowEnd}`));
  const from = new Date(Math.max(
    new Date(rhythm.activeFrom).getTime(),
    now.getTime() - 28 * 24 * 60 * 60 * 1000,
  ));
  const additions = opportunityWindows(rhythm, from, now)
    .filter((window) => !existingKeys.has(`${window.windowStart}:${window.windowEnd}`))
    .map((window) => ({
      UUID: `rhythm-opportunity:${rhythm.UUID}:${window.windowStart}`,
      rhythmUUID: rhythm.UUID,
      parent: player.UUID,
      ...window,
      status: new Date(window.windowEnd).getTime() <= now.getTime() ? 'expired' : 'pending',
      evidenceUUID: null,
      resolutionReason: null,
      resolvedAt: null,
      createdAt: now.toISOString(),
    }));
  if (additions.length) {
    await databaseConnection.commitAtomicMutation({
      label: 'rhythm-opportunity-generation',
      puts: additions.map((record) => ({ store: STORES.rhythmOpportunity, record })),
    });
  }
  return rhythm;
}

export async function completeCurrentRhythmOpportunity(
  databaseConnection,
  player,
  tracker,
  evidenceUUID,
  occurredAt = new Date().toISOString(),
) {
  const rhythm = await ensureRhythmForTracker(databaseConnection, player, tracker, new Date(occurredAt));
  if (!rhythm) return null;
  const opportunities = await databaseConnection.getPlayerStore(STORES.rhythmOpportunity, player.UUID);
  const occurred = new Date(occurredAt).getTime();
  const current = opportunities.find((row) => (
    row.rhythmUUID === rhythm.UUID
    && row.status === 'pending'
    && new Date(row.windowStart).getTime() <= occurred
    && new Date(row.windowEnd).getTime() > occurred
  ));
  if (!current) return null;
  const next = {
    ...current,
    status: 'completed',
    evidenceUUID,
    resolutionReason: 'life-evidence',
    resolvedAt: occurredAt,
    updatedAt: occurredAt,
  };
  await databaseConnection.add(STORES.rhythmOpportunity, next);
  return next;
}

export function summarizeRhythm(opportunities = [], now = Date.now()) {
  const eligible = opportunities.filter((row) => (
    row.status !== 'pending' || new Date(row.windowEnd).getTime() <= Number(now)
  ));
  const completed = eligible.filter((row) => row.status === 'completed');
  const returnTimes = [];
  let missedAt = null;
  for (const row of [...opportunities].sort((a, b) => String(a.windowStart).localeCompare(String(b.windowStart)))) {
    if (['expired', 'blocked'].includes(row.status)) missedAt = new Date(row.windowEnd).getTime();
    if (row.status === 'completed' && missedAt != null) {
      returnTimes.push(Math.max(0, new Date(row.resolvedAt || row.windowEnd).getTime() - missedAt));
      missedAt = null;
    }
  }
  return Object.freeze({
    completed: completed.length,
    eligible: eligible.length,
    reliability: eligible.length ? completed.length / eligible.length : null,
    medianReturnMs: median(returnTimes),
    streak: (() => {
      let value = 0;
      for (const row of [...opportunities].sort((a, b) => String(b.windowStart).localeCompare(String(a.windowStart)))) {
        if (row.status !== 'completed') break;
        value += 1;
      }
      return value;
    })(),
  });
}
