export function mobileDateKey(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function mobileDateFromKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function moveMobileDay(key, amount) {
  const date = mobileDateFromKey(key);
  date.setDate(date.getDate() + amount);
  return mobileDateKey(date);
}

export function mobileDueKey(value) {
  return value ? mobileDateKey(value) : '';
}

export function getDateSlideDirection(previousDate, nextDate) {
  if (previousDate === nextDate) return 'none';
  return mobileDateFromKey(nextDate).getTime() > mobileDateFromKey(previousDate).getTime()
    ? 'forward'
    : 'backward';
}

export function mobileDaySwipeDirection(start, end, {
  threshold = 64,
  axisRatio = 1.35,
} = {}) {
  if (!start || !end) return 0;
  const horizontal = Number(end.x) - Number(start.x);
  const vertical = Number(end.y) - Number(start.y);
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return 0;
  if (Math.abs(horizontal) < threshold) return 0;
  if (Math.abs(horizontal) <= Math.abs(vertical) * axisRatio) return 0;
  return horizontal < 0 ? 1 : -1;
}

export function nearestApplicableReminder(
  reminders = [],
  selectedDate = mobileDateKey(),
  today = mobileDateKey(),
) {
  return [...reminders]
    .filter((reminder) => !reminder.completedAt && !reminder.dismissedAt)
    .filter((reminder) => {
      const due = mobileDueKey(reminder.snoozedUntil || reminder.remindAt);
      return due === selectedDate || (selectedDate === today && due && due < today);
    })
    .sort((left, right) => (
      new Date(left.snoozedUntil || left.remindAt).getTime()
      - new Date(right.snoozedUntil || right.remindAt).getTime()
    ))[0] || null;
}

