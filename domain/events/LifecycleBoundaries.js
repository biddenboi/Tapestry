const DAY_MS = 24 * 60 * 60 * 1000;

function scheduledTimeOnDate(time, baseDate) {
  if (!time) return null;
  const [hours, minutes] = String(time).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function getNextDailyLifecycleBoundary(player, now = new Date()) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  const candidates = [];

  const midnight = new Date(current);
  midnight.setHours(24, 0, 0, 0);
  candidates.push({ type: 'day-boundary', at: midnight.getTime() });

  for (const [type, time] of [['wake', player?.wakeTime], ['sleep', player?.sleepTime]]) {
    const scheduled = scheduledTimeOnDate(time, current);
    if (!scheduled) continue;
    if (scheduled.getTime() <= current.getTime()) scheduled.setDate(scheduled.getDate() + 1);
    candidates.push({ type, at: scheduled.getTime() });
  }

  candidates.sort((a, b) => a.at - b.at || a.type.localeCompare(b.type));
  return Object.freeze(candidates[0] || { type: 'day-boundary', at: current.getTime() + DAY_MS });
}
