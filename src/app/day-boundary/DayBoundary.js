const END_OF_DAY_KEY_PREFIX = 'tapestry_eod';
const END_OF_DAY_SETTING_PREFIX = 'day-boundary:';
const WAKE_SETTING_PREFIX = 'wake-boundary:';
const DAILY_LIFECYCLE_LAUNCH_SETTING_ID = 'day-boundary:next-launch';
const APP_SETTING_STORE = 'appSettings';
const DAILY_LIFECYCLE_LAUNCH_STATES = new Set([
  'profile-selection-required',
  'wake-required',
  'completed',
]);

const APP_LAUNCH_ID = (() => {
  try {
    return globalThis.crypto?.randomUUID?.() || `launch-${Date.now()}-${Math.random()}`;
  } catch {
    return `launch-${Date.now()}-${Math.random()}`;
  }
})();

function availableStorage(storage = null) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function getEndOfDayStorageKey(dateStr) {
  return `${END_OF_DAY_KEY_PREFIX}_${dateStr}`;
}

export function getEndOfDayState(_playerUUID, dateStr, storage = null) {
  if (!dateStr) return null;
  if (!storage) return null;
  return storage.getItem(getEndOfDayStorageKey(dateStr));
}

export function setEndOfDayState(_playerUUID, dateStr, state, storage = null) {
  if (!dateStr || !storage) return;
  storage.setItem(getEndOfDayStorageKey(dateStr), state);
}

export function getEndOfDaySettingId(dateStr) {
  return `${END_OF_DAY_SETTING_PREFIX}${dateStr}`;
}

export async function getDurableEndOfDayState(
  databaseConnection,
  playerUUID,
  dateStr,
  storage = null,
) {
  const cachedState = getEndOfDayState(playerUUID, dateStr, storage);
  if (!databaseConnection?.get || !dateStr) return cachedState;

  try {
    const setting = await databaseConnection.get(
      APP_SETTING_STORE,
      getEndOfDaySettingId(dateStr),
    );
    const durableState = setting?.state || null;
    const state = durableState === 'chosen' || cachedState === 'chosen'
      ? 'chosen'
      : durableState || cachedState;
    if (state && state !== cachedState) {
      setEndOfDayState(playerUUID, dateStr, state, storage);
    }
    return state;
  } catch {
    return cachedState;
  }
}

export async function setDurableEndOfDayState(
  databaseConnection,
  playerUUID,
  dateStr,
  state,
  storage = null,
) {
  setEndOfDayState(playerUUID, dateStr, state, storage);
  if (!databaseConnection?.add || !dateStr) return;

  await databaseConnection.add(APP_SETTING_STORE, {
    UUID: getEndOfDaySettingId(dateStr),
    state,
    updatedAt: new Date().toISOString(),
  });
}

export function getWakePendingStorageKey(playerUUID, dateStr) {
  return `tapestry_wake_pending_${playerUUID}_${dateStr}`;
}

export function getWakeCompletedStorageKey(playerUUID, dateStr) {
  return `tapestry_wake_completed_${playerUUID}_${dateStr}`;
}

export function getWakeSettingId(playerUUID, dateStr) {
  return `${WAKE_SETTING_PREFIX}${playerUUID}:${dateStr}`;
}

export function getDailyLifecycleAppLaunchId() {
  return APP_LAUNCH_ID;
}

export function getDailyLifecycleLaunchSettingId() {
  return DAILY_LIFECYCLE_LAUNCH_SETTING_ID;
}

export async function getDailyLifecycleLaunchState(databaseConnection) {
  if (!databaseConnection?.get) return null;
  try {
    const state = await databaseConnection.get(
      APP_SETTING_STORE,
      DAILY_LIFECYCLE_LAUNCH_SETTING_ID,
    );
    if (!state?.flowId || !DAILY_LIFECYCLE_LAUNCH_STATES.has(state.state)) return null;
    return state;
  } catch {
    return null;
  }
}

export async function requireDailyLifecycleProfileSelection(
  databaseConnection,
  {
    sourcePlayerUUID,
    endedAt = new Date().toISOString(),
    eodDateStr,
    sourceLaunchId = APP_LAUNCH_ID,
  } = {},
) {
  if (!databaseConnection?.add || !sourcePlayerUUID || !eodDateStr) return null;
  const flowId = `${sourcePlayerUUID}:${endedAt}`;
  const state = {
    UUID: DAILY_LIFECYCLE_LAUNCH_SETTING_ID,
    flowId,
    state: 'profile-selection-required',
    sourcePlayerUUID: String(sourcePlayerUUID),
    selectedPlayerUUID: null,
    eodDateStr,
    endedAt,
    sourceLaunchId,
    updatedAt: new Date().toISOString(),
  };
  await databaseConnection.add(APP_SETTING_STORE, state);
  return state;
}

export async function requireDailyLifecycleWake(
  databaseConnection,
  {
    flowId,
    selectedPlayerUUID,
    selectionLaunchId = APP_LAUNCH_ID,
  } = {},
) {
  if (!databaseConnection?.add || !flowId || !selectedPlayerUUID) return null;
  const current = await getDailyLifecycleLaunchState(databaseConnection);
  if (!current || current.flowId !== flowId || current.state === 'completed') return current;
  const state = {
    ...current,
    state: 'wake-required',
    selectedPlayerUUID: String(selectedPlayerUUID),
    selectionLaunchId,
    updatedAt: new Date().toISOString(),
  };
  await databaseConnection.add(APP_SETTING_STORE, state);
  return state;
}

export async function completeDailyLifecycleLaunch(
  databaseConnection,
  {
    flowId,
    selectedPlayerUUID,
  } = {},
) {
  if (!databaseConnection?.add || !flowId) return null;
  const current = await getDailyLifecycleLaunchState(databaseConnection);
  if (!current || current.flowId !== flowId) return current;
  const state = {
    ...current,
    state: 'completed',
    selectedPlayerUUID: String(selectedPlayerUUID || current.selectedPlayerUUID || ''),
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await databaseConnection.add(APP_SETTING_STORE, state);
  return state;
}

export async function getDurableWakeState(
  databaseConnection,
  playerUUID,
  dateStr,
  storage = null,
) {
  if (!playerUUID || !dateStr) return null;
  const cache = availableStorage(storage);
  const completed = cache?.getItem(getWakeCompletedStorageKey(playerUUID, dateStr)) === 'done';
  const pendingState = cache?.getItem(getWakePendingStorageKey(playerUUID, dateStr)) || null;
  let durableState = null;

  if (databaseConnection?.get) {
    try {
      const setting = await databaseConnection.get(
        APP_SETTING_STORE,
        getWakeSettingId(playerUUID, dateStr),
      );
      durableState = setting?.state || null;
    } catch {
      durableState = null;
    }
  }

  if (completed || durableState === 'completed') return 'completed';
  if (pendingState === 'submitting' || durableState === 'submitting') return 'submitting';
  return pendingState || durableState;
}

export async function setDurableWakeState(
  databaseConnection,
  playerUUID,
  dateStr,
  state,
  storage = null,
) {
  if (!playerUUID || !dateStr) return;
  const cache = availableStorage(storage);
  const pendingKey = getWakePendingStorageKey(playerUUID, dateStr);
  const completedKey = getWakeCompletedStorageKey(playerUUID, dateStr);
  const completedBeforeWrite = cache?.getItem(completedKey) === 'done';
  const nextState = completedBeforeWrite ? 'completed' : state;

  if (cache) {
    if (nextState === 'completed') {
      cache.setItem(completedKey, 'done');
      cache.removeItem(pendingKey);
    } else {
      cache.setItem(pendingKey, nextState);
    }
  }

  if (!databaseConnection?.add) return;
  await databaseConnection.add(APP_SETTING_STORE, {
    UUID: getWakeSettingId(playerUUID, dateStr),
    state: nextState,
    updatedAt: new Date().toISOString(),
  });

  // A slower "shown" write can be overtaken by completion and then land last.
  // Re-check the synchronous completion latch after persistence so that daily
  // state can only move forward.
  if (nextState !== 'completed' && cache?.getItem(completedKey) === 'done') {
    await databaseConnection.add(APP_SETTING_STORE, {
      UUID: getWakeSettingId(playerUUID, dateStr),
      state: 'completed',
      updatedAt: new Date().toISOString(),
    });
  }
}

export function shouldShowWakePrompt({ completedToday = false, wakeState = null } = {}) {
  return !completedToday && wakeState !== 'completed';
}

export function shouldAdvancePastPriorSleep(endOfDayState) {
  return endOfDayState !== 'shown';
}

export function needsInitialProfile(player) {
  return !player?.UUID;
}
