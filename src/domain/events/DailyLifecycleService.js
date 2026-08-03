import { STORES } from '@domain/constants.js';
import {
  computeSleepDelta,
  endDay,
  endWorkDay,
  getBackfilledSleepDate,
  normalizeRitualChecklist,
  prepareNextProfileAfterSleep as prepareProfileHandoffPrimitive,
  pruneFutureDayEvents,
  startDay,
} from '@domain/events/Events.js';
import {
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
  shouldAdvancePastPriorSleep,
  shouldShowWakePrompt,
} from '@domain/events/DayBoundary.js';

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
  void checklist;
  void selected;
  await setDurableWakeState(
    databaseConnection,
    updatedPlayer.UUID,
    dateKey(confirmedAt),
    'completed',
  );
  return Object.freeze({ updatedPlayer, wakeContribution: null, confirmedAt: wakeConfirmedAt, rewardPolicy: 'context-only' });
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
  const dayResult = await endDay(databaseConnection, player, false, endedAt, {
    checklistItems: checklist,
    checkedItems: selected,
    achievementContext,
  });
  return Object.freeze({
    endedAt,
    deltaMs,
    contribution: null,
    forfeitTokens: false,
    rewardPolicy: 'context-only',
  });
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
    forfeitTokens: false,
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
