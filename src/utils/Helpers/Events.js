import { v4 as uuid } from 'uuid';
import { EVENT, STORES } from '../Constants.js';

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

export async function startDay(db, player) {
  if (!player) return;
  await db.add(STORES.player, {
    ...player,
    minutesClearedToday: 0,
  });
  await writeEvent(db, player, EVENT.wake, 'Started the day');
}

export async function endWorkDay(db, player) {
  if (!player) return;
  await writeEvent(db, player, EVENT.end_work, 'Ended work day');
}

/**
 * End the day.
 * loseAll = false → user manually ended before sleep time → keep all tokens
 * loseAll = true  → sleep time passed without ending → lose all tokens
 */
export async function endDay(db, player, loseAll = false, createdAt = new Date().toISOString()) {
  if (!player) return;

  const newTokens = loseAll ? 0 : (player.tokens || 0);
  const description = loseAll
    ? 'Sleep time passed — all tokens forfeited'
    : 'Day ended — tokens preserved';

  await db.add(STORES.player, {
    ...player,
    tokens: newTokens,
  });

  await writeEvent(db, player, EVENT.sleep, description, createdAt);
}

/**
 * Parse player sleepTime ("HH:MM") into today's Date object.
 * Returns null if sleepTime is not set.
 */
export function getSleepDateToday(sleepTime) {
  return getSleepDateForDate(sleepTime, new Date());
}

/**
 * Parse player sleepTime ("HH:MM") into a Date object on the provided
 * calendar day in local time.
 */
export function getSleepDateForDate(sleepTime, baseDate = new Date()) {
  if (!sleepTime) return null;
  const [h, m] = sleepTime.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Backfill the sleep event for a missed end-of-day flow onto the day that is
 * being closed, instead of the current moment. Falls back to the final
 * millisecond of that day when sleepTime is missing or invalid.
 */
export function getBackfilledSleepDate(sleepTime, dayToClose = new Date()) {
  const sleepDate = getSleepDateForDate(sleepTime, dayToClose);
  if (sleepDate) return sleepDate;
  const fallback = new Date(dayToClose);
  fallback.setHours(23, 59, 59, 999);
  return fallback;
}

/**
 * Remove any start-day (wake) / end-day (sleep) events for this player whose
 * createdAt is in the future. This can happen if the device clock was wound
 * forward, an import injected future-dated events, or a timezone shift left
 * stray entries ahead of "now".
 *
 * Strategy (per spec): pull the player's events, sort newest-first, walk
 * deleting future entries and stop at the first non-future entry — after that
 * everything is guaranteed to be in the past.
 *
 * Returns the number of deleted events.
 */
export async function pruneFutureDayEvents(db, playerUUID) {
  if (!db || !playerUUID) return 0;
  const events = await db.getPlayerStore(STORES.event, playerUUID);
  if (!events || events.length === 0) return 0;

  // Newest-first
  events.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const now = Date.now();
  const toDelete = [];
  for (const entry of events) {
    const t = new Date(entry.createdAt).getTime();
    if (Number.isFinite(t) && t > now) {
      if (entry.type === EVENT.wake || entry.type === EVENT.sleep) {
        toDelete.push(entry.UUID);
      }
      // keep walking — a non-wake/sleep future event still tells us we're in
      // the future window, but if it's, say, an end_work, leave it alone.
    } else {
      // First past-or-present entry reached: everything after is older.
      break;
    }
  }

  for (const uuid of toDelete) {
    // eslint-disable-next-line no-await-in-loop
    await db.remove(STORES.event, uuid);
  }
  return toDelete.length;
}
