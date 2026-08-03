function validDate(value, fallback = new Date()) {
  const parsed = new Date(value || fallback);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
}

export function reminderPresetTime(preset, now = new Date()) {
  const base = validDate(now);
  if (preset === '30m') return new Date(base.getTime() + 30 * 60_000).toISOString();
  if (preset === '1h') return new Date(base.getTime() + 60 * 60_000).toISOString();
  if (preset === 'evening') {
    const evening = new Date(base);
    evening.setHours(20, 0, 0, 0);
    if (evening <= base) evening.setDate(evening.getDate() + 1);
    return evening.toISOString();
  }
  const tomorrow = new Date(base);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}

export function resolveReminderSnooze(choice, { now = new Date(), customAt = null } = {}) {
  const base = validDate(now);
  if (choice === '10m') return new Date(base.getTime() + 10 * 60_000).toISOString();
  if (choice === '30m') return new Date(base.getTime() + 30 * 60_000).toISOString();
  if (choice === '1h') return new Date(base.getTime() + 60 * 60_000).toISOString();
  if (choice === 'tomorrow') return reminderPresetTime('tomorrow', base);
  const custom = validDate(customAt, new Date(NaN));
  if (!Number.isFinite(custom.getTime()) || custom <= base) throw new Error('Choose a future snooze time.');
  return custom.toISOString();
}

