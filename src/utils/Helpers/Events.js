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

export async function endDay(db, player, early = false) {
  if (!player) return;
  const remainingLoad = Math.max(0, Math.ceil((player.minutesClearedToday || 0) / 15));
  const penalty = early ? Math.ceil(remainingLoad / 2) : remainingLoad;

  await db.add(STORES.player, {
    ...player,
    tokens: Math.max(0, (player.tokens || 0) - penalty),
  });

  await writeEvent(
    db,
    player,
    EVENT.sleep,
    early ? `Ended day early (-${penalty} tokens)` : `Ended day (-${penalty} tokens)`,
  );
}
