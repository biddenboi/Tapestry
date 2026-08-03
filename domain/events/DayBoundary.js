const END_OF_DAY_KEY_PREFIX = 'tapestry_eod';
const END_OF_DAY_SETTING_PREFIX = 'day-boundary:';
const WAKE_SETTING_PREFIX = 'wake-boundary:';
const APP_SETTING_STORE = 'appSettings';

export function getEndOfDayStorageKey(dateStr) {
  return `${END_OF_DAY_KEY_PREFIX}_${dateStr}`;
}

function getLegacyEndOfDayStorageKey(playerUUID, dateStr) {
  return playerUUID ? `${END_OF_DAY_KEY_PREFIX}_${playerUUID}_${dateStr}` : null;
}

export function getEndOfDayState(playerUUID, dateStr, storage = null) {
  if (!dateStr) return null;
  if (!storage) return null;
  const current = storage.getItem(getEndOfDayStorageKey(dateStr));
  if (current) return current;

  const legacyKey = getLegacyEndOfDayStorageKey(playerUUID, dateStr);
  return legacyKey ? storage.getItem(legacyKey) : null;
}

export function setEndOfDayState(playerUUID, dateStr, state, storage = null) {
  if (!dateStr || !storage) return;
  storage.setItem(getEndOfDayStorageKey(dateStr), state);

  const legacyKey = getLegacyEndOfDayStorageKey(playerUUID, dateStr);
  if (legacyKey) storage.setItem(legacyKey, state);
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

export async function getDurableWakeState(
  databaseConnection,
  playerUUID,
  dateStr,
  storage = null,
) {
  if (!playerUUID || !dateStr) return null;
  const completed = storage?.getItem(getWakeCompletedStorageKey(playerUUID, dateStr)) === 'done';
  const pendingState = storage?.getItem(getWakePendingStorageKey(playerUUID, dateStr)) || null;
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
  const pendingKey = getWakePendingStorageKey(playerUUID, dateStr);
  const completedKey = getWakeCompletedStorageKey(playerUUID, dateStr);

  if (storage) {
    if (state === 'completed') {
      storage.setItem(completedKey, 'done');
      storage.removeItem(pendingKey);
    } else {
      storage.setItem(pendingKey, state);
    }
  }

  if (!databaseConnection?.add) return;
  await databaseConnection.add(APP_SETTING_STORE, {
    UUID: getWakeSettingId(playerUUID, dateStr),
    state,
    updatedAt: new Date().toISOString(),
  });
}

export function shouldShowWakePrompt({ completedToday = false, wakeState = null } = {}) {
  return !completedToday && wakeState !== 'completed' && wakeState !== 'submitting';
}

export function shouldAdvancePastPriorSleep(endOfDayState) {
  return endOfDayState !== 'shown';
}

export function needsInitialProfile(player) {
  return !player?.UUID;
}
