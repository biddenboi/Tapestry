export const TRACKER_TYPES = Object.freeze(['one_time', 'quantity', 'duration']);

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const dateKeyFromDate = (date = new Date()) => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

export const logDateKey = (log) => log?.loggedDate || dateKeyFromDate(log?.loggedAt);

export const shiftDateKey = (key, deltaDays) => {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return dateKeyFromDate(date);
};

export function findActiveDurationSession(logs = []) {
  const stopped = new Set(
    logs
      .filter((log) => log?.action === 'stop' && log.sessionUUID)
      .map((log) => String(log.sessionUUID)),
  );
  return logs
    .filter((log) => log?.action === 'start' && log.sessionUUID)
    .filter((log) => !stopped.has(String(log.sessionUUID)))
    .sort((left, right) => String(right.loggedAt || '').localeCompare(String(left.loggedAt || '')))[0] || null;
}

function durationFromLogForDate(log, key) {
  if (log?.action !== 'stop' || log.status !== 'success') return 0;
  if (Array.isArray(log.segments) && log.segments.length) {
    return log.segments
      .filter((segment) => segment?.loggedDate === key)
      .reduce((total, segment) => total + Math.max(0, safeNumber(segment.durationMs)), 0);
  }
  return logDateKey(log) === key ? Math.max(0, safeNumber(log.value)) : 0;
}

function activeDurationForDate(session, key, nowMs) {
  if (!session?.loggedAt) return 0;
  const startedMs = new Date(session.loggedAt).getTime();
  if (!Number.isFinite(startedMs) || nowMs <= startedMs) return 0;
  const dayStart = new Date(`${key}T00:00:00`).getTime();
  const nextDay = new Date(`${key}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const dayEnd = nextDay.getTime();
  return Math.max(0, Math.min(nowMs, dayEnd) - Math.max(startedMs, dayStart));
}

export function totalForTrackerDate(type, logs, key, activeSession = null, nowMs = Date.now()) {
  if (type === 'one_time') {
    return logs.some((log) => log.status === 'success' && log.action === 'complete' && logDateKey(log) === key) ? 1 : 0;
  }
  if (type === 'quantity') {
    return logs
      .filter((log) => log.status === 'success' && log.action === 'add' && logDateKey(log) === key)
      .reduce((total, log) => total + Math.max(0, safeNumber(log.value)), 0);
  }
  if (type === 'duration') {
    const stoppedTotal = logs.reduce((total, log) => total + durationFromLogForDate(log, key), 0);
    return stoppedTotal + activeDurationForDate(activeSession, key, nowMs);
  }
  return 0;
}

function computeStreak(type, logs, todayKey, activeSession, nowMs) {
  let cursor = totalForTrackerDate(type, logs, todayKey, activeSession, nowMs) > 0
    ? todayKey
    : shiftDateKey(todayKey, -1);
  let streak = 0;
  for (let index = 0; index < 365 * 5; index += 1) {
    if (totalForTrackerDate(type, logs, cursor, null, nowMs) <= 0) break;
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

function buildSeries(type, logs, todayKey, activeSession, nowMs, days) {
  return Array.from({ length: days }, (_, index) => {
    const key = shiftDateKey(todayKey, index - (days - 1));
    const date = new Date(`${key}T12:00:00`);
    return {
      key,
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
      value: totalForTrackerDate(type, logs, key, activeSession, nowMs),
    };
  });
}

export function buildHabitCardModel({ event, logs = [], todayKey = dateKeyFromDate(), nowMs = Date.now() } = {}) {
  const type = event?.type;
  if (!TRACKER_TYPES.includes(type)) return null;
  const currentEraLogs = logs.filter((log) => log?.trackingEraId === event.currentEraId);
  const activeSession = type === 'duration' ? findActiveDurationSession(currentEraLogs) : null;
  const todayTotal = totalForTrackerDate(type, currentEraLogs, todayKey, activeSession, nowMs);
  const target = type === 'one_time' ? 1 : Math.max(1, safeNumber(event?.dailyTarget, 1));
  const complete = type === 'one_time'
    ? todayTotal >= 1
    : type === 'duration'
      ? !activeSession && todayTotal >= target
      : todayTotal >= target;
  const streak = computeStreak(type, currentEraLogs, todayKey, activeSession, nowMs);
  const chartDays = type === 'one_time' ? 84 : 14;
  const series = buildSeries(type, currentEraLogs, todayKey, activeSession, nowMs, chartDays);
  const unit = type === 'quantity' ? String(event?.unit || 'units') : type === 'duration' ? 'time' : 'day';

  return {
    id: String(event.UUID),
    event,
    type,
    name: event.name || 'Untitled event',
    description: event.description || '',
    accentColor: event.accentColor || '#a78bfa',
    currentEraLogs,
    activeSession,
    isRunning: Boolean(activeSession),
    complete,
    todayTotal,
    target,
    unit,
    streak,
    rhythmLabel: (() => {
      const cadence = event.rhythmCadenceType || 'daily';
      if (cadence === 'weekdays') {
        const labels = (event.eligibleWeekdays || [])
          .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
          .filter(Boolean);
        return labels.length ? `Rhythm · ${labels.join(', ')}` : 'Rhythm · selected weekdays';
      }
      if (cadence === 'times-per-week') return `Rhythm · ${event.opportunitiesPerPeriod || 1}× per week`;
      if (cadence === 'duration-per-week') return `Rhythm · weekly duration`;
      if (cadence === 'event-triggered') return 'Rhythm · event-triggered';
      return 'Rhythm · daily opportunity';
    })(),
    progress: Math.min(100, (todayTotal / target) * 100),
    series,
  };
}

export function buildHabitPageModel({ events = [], logsByEvent = {}, todayKey = dateKeyFromDate(), nowMs = Date.now() } = {}) {
  const cards = events
    .map((event) => buildHabitCardModel({
      event,
      logs: logsByEvent[event?.UUID] || [],
      todayKey,
      nowMs,
    }))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    cards,
    active: cards.filter((card) => !card.complete),
    completed: cards.filter((card) => card.complete),
    summary: {
      total: cards.length,
      completed: cards.filter((card) => card.complete).length,
      running: cards.filter((card) => card.isRunning).length,
    },
  };
}
