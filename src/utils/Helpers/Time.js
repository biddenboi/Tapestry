import { DAY, WEEK, STRING_DAYS } from '../Constants.js';

export const timeAsHHMMSS = (ms = 0) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const msToSeconds = (ms = 0) => Math.floor(ms / 1000);
export const msToPoints = (ms = 0) => Math.max(0, Math.floor(ms / 10000));

export const addDurationToDate = (date, durationMs) =>
  new Date(new Date(date).getTime() + Number(durationMs || 0));

export const getLocalDate = (input = new Date()) => {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getMidnightOfDate = (input = new Date()) => getLocalDate(input);

export const getMsUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
};

export const formatDateAsLocalString = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export const getTimeAsString = (value) => value;

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
  const totalMinutes = Math.floor(abs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function UTCStringToLocalTime(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function UTCStringToLocalDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getDateAsString(date) {
  return date.split('T')[0];
}
