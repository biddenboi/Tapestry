import { STORES } from '@domain/constants.js';
import {
  applyPendingSleepTimeBuff,
  applyWakeTimeBuff,
  computeSleepDelta,
  computeSleepTimeMultiplier,
  computeWakeDelta,
  endDay,
  endWorkDay,
  getBackfilledSleepDate,
  normalizeRitualChecklist,
  prepareNextProfileAfterSleep as prepareProfileHandoffPrimitive,
  pruneFutureDayEvents,
  startDay,
} from '@domain/events/Events.js';
import {
  getDurableEndOfDayState,
  getDurableWakeState,
  getWakeCompletedStorageKey,
  getWakePendingStorageKey,
  needsInitialProfile,
  setDurableEndOfDayState,
  setDurableWakeState,
  shouldAdvancePastPriorSleep,
  shouldShowWakePrompt,
} from '@domain/events/DayBoundary.js';

export {
  getDurableEndOfDayState,
  getDurableWakeState,
  getWakeCompletedStorageKey,
  getWakePendingStorageKey,
  needsInitialProfile,
  setDurableEndOfDayState,
  setDurableWakeState,
  shouldAdvancePastPriorSleep,
  shouldShowWakePrompt,
};

function dateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export async function enterDailyLifecycle({
  databaseConnection,
  player,
  confirmedAt = Date.now(),
  checkedItems = [],
} = {}) {
  if (!databaseConnection || !player?.UUID) return null;
  const current = await databaseConnection.getCurrentPlayer();
  if (!current) return null;
  const checklist = normalizeRitualChecklist(current.wakeChecklist);
  const selected = normalizeRitualChecklist(checkedItems);
  const wakeConfirmedAt = new Date(confirmedAt).toISOString();
  const updatedPlayer = { ...current, wakeConfirmedAt };

  await databaseConnection.add(STORES.player, updatedPlayer);
  await startDay(databaseConnection, updatedPlayer);
  const wakeBuff = await applyWakeTimeBuff(
    databaseConnection,
    updatedPlayer,
    computeWakeDelta(updatedPlayer.wakeTime || '07:00', confirmedAt),
    selected.length,
    checklist.length,
    selected,
  );
  const sleepBuff = await applyPendingSleepTimeBuff(databaseConnection, updatedPlayer);
  await setDurableWakeState(
    databaseConnection,
    updatedPlayer.UUID,
    dateKey(confirmedAt),
    'completed',
  );
  await databaseConnection.flushLinkedFolderWrite?.();
  return Object.freeze({ updatedPlayer, wakeBuff, sleepBuff, confirmedAt: wakeConfirmedAt });
}

export async function completeDailyLifecycle({
  databaseConnection,
  player,
  endedAt = new Date().toISOString(),
  checkedItems = [],
  achievementContext = {},
  forfeitTokens = false,
} = {}) {
  if (!databaseConnection || !player?.UUID) return null;
  const checklist = normalizeRitualChecklist(player.sleepChecklist);
  const selected = normalizeRitualChecklist(checkedItems);
  const deltaMs = computeSleepDelta(player.sleepTime || '23:00', new Date(endedAt).getTime());
  const multiplierValue = computeSleepTimeMultiplier(deltaMs, selected.length, checklist.length);
  await endDay(databaseConnection, player, forfeitTokens, endedAt, {
    checklistItems: checklist,
    checkedItems: selected,
    achievementContext,
  });
  return Object.freeze({ endedAt, deltaMs, multiplierValue, forfeitTokens });
}

export async function applyMissedDailyLifecyclePenalty({
  databaseConnection,
  player,
  previousActivityAt,
} = {}) {
  if (!databaseConnection || !player?.UUID) return null;
  const penaltyAt = getBackfilledSleepDate(player.sleepTime, previousActivityAt);
  return completeDailyLifecycle({
    databaseConnection,
    player,
    endedAt: penaltyAt.toISOString(),
    forfeitTokens: true,
  });
}

export async function prepareProfileHandoff(databaseConnection, sourcePlayerUUID, targetPlayerUUID) {
  return prepareProfileHandoffPrimitive(databaseConnection, sourcePlayerUUID, targetPlayerUUID);
}

export async function completeWorkLifecycle(databaseConnection, player) {
  return endWorkDay(databaseConnection, player);
}

export async function reconcileDailyLifecycle(databaseConnection, player) {
  if (!databaseConnection || !player?.UUID) return { futureEventsRemoved: 0 };
  const futureEventsRemoved = await pruneFutureDayEvents(databaseConnection, player.UUID);
  return Object.freeze({ futureEventsRemoved });
}
