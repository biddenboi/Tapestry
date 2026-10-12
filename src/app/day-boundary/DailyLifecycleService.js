import { v4 as uuid } from 'uuid';
import { EVENT, STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { startR1Shift, endR1Shift } from './R1DayBoundary.js';
import { setDurableWakeState } from './DayBoundary.js';

export {
  completeDailyLifecycleLaunch,
  getDailyLifecycleAppLaunchId,
  getDailyLifecycleLaunchSettingId,
  getDailyLifecycleLaunchState,
  getDurableEndOfDayState,
  getDurableWakeState,
  getWakeCompletedStorageKey,
  getWakePendingStorageKey,
  needsInitialProfile,
  requireDailyLifecycleProfileSelection,
  requireDailyLifecycleWake,
  setDurableEndOfDayState,
  setDurableWakeState,
} from './DayBoundary.js';

async function writeBoundary(db, player, type, createdAt) {
  await db.add(STORES.event, {
    UUID: uuid(), parent: player.UUID, type, createdAt,
    inGameTimestamp: getCurrentIGT(player),
    description: type === EVENT.wake ? 'Started the day' : 'Ended work',
  });
}

export async function enterDailyLifecycle({ databaseConnection: db, player, confirmedAt = Date.now() } = {}) {
  if (!db || !player?.UUID) return null;
  const current = await db.getCurrentPlayer();
  if (!current || String(current.UUID) !== String(player.UUID)) return null;
  const now = new Date(confirmedAt);
  const updatedPlayer = { ...current, wakeConfirmedAt: now.toISOString(), minutesClearedToday: 0 };
  await db.add(STORES.player, updatedPlayer);
  await startR1Shift(db, updatedPlayer, now);
  await writeBoundary(db, updatedPlayer, EVENT.wake, now.toISOString());
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await setDurableWakeState(db, updatedPlayer.UUID, dateKey, 'completed');
  return { updatedPlayer, confirmedAt: now.toISOString() };
}

export async function completeDailyLifecycle({ databaseConnection: db, player, endedAt = new Date().toISOString() } = {}) {
  if (!db || !player?.UUID) return null;
  await endR1Shift(db, player, new Date(endedAt));
  await writeBoundary(db, player, EVENT.sleep, endedAt);
  return { endedAt };
}

export async function prepareProfileHandoff(db, sourcePlayerUUID, targetPlayerUUID) {
  if (!sourcePlayerUUID || !targetPlayerUUID) return null;
  return db.get(STORES.player, targetPlayerUUID);
}
