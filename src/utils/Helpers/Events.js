import { v4 as uuid } from 'uuid';
import { EVENT, STORES } from '../Constants.js';

async function writeEvent(db, player, type, description) {
  if (!player) return null;
  const entry = {
    UUID: uuid(),
    parent: player.UUID,
    type,
    description,
    createdAt: new Date().toISOString(),
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
export async function endDay(db, player, loseAll = false) {
  if (!player) return;

  const newTokens = loseAll ? 0 : (player.tokens || 0);
  const description = loseAll
    ? `Sleep time passed — all tokens forfeited`
    : `Day ended — tokens preserved`;

  await db.add(STORES.player, {
    ...player,
    tokens: newTokens,
  });

  await writeEvent(db, player, EVENT.sleep, description);
}

/**
 * Parse player sleepTime ("HH:MM") into today's Date object.
 * Returns null if sleepTime is not set.
 */
export function getSleepDateToday(sleepTime) {
  if (!sleepTime) return null;
  const [h, m] = sleepTime.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
