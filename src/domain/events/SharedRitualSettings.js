import { STORES } from '../constants.js';
import { normalizeRitualChecklist } from './Events.js';
import { queueProfileWrite } from '../profile/ProfileWriteQueue.js';

function sameChecklist(left, right) {
  const a = normalizeRitualChecklist(left);
  const b = normalizeRitualChecklist(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function profileRitualDefaults(player = {}) {
  return Object.freeze({
    wakeTime: player.wakeTime || '08:00',
    sleepTime: player.sleepTime || '23:00',
    wakeChecklist: normalizeRitualChecklist(player.wakeChecklist),
    sleepChecklist: normalizeRitualChecklist(player.sleepChecklist),
  });
}

export function saveSharedRitualSettings(databaseConnection, activePlayer, options = {}) {
  return queueProfileWrite(databaseConnection, () => saveSharedRitualSettingsInternal(databaseConnection, activePlayer, options));
}

async function saveSharedRitualSettingsInternal(databaseConnection, activePlayer, {
  activePatch = {},
  wakeChecklist = activePatch.wakeChecklist,
  sleepChecklist = activePatch.sleepChecklist,
  at = new Date(),
} = {}) {
  if (!databaseConnection?.commitAtomicMutation || !activePlayer?.UUID) {
    throw new TypeError('Shared ritual settings require an active profile and database connection.');
  }
  const players = await databaseConnection.getAll(STORES.player);
  const latest = players.find((player) => String(player.UUID) === String(activePlayer.UUID)) || activePlayer;
  const wake = normalizeRitualChecklist(wakeChecklist ?? latest.wakeChecklist);
  const sleep = normalizeRitualChecklist(sleepChecklist ?? latest.sleepChecklist);
  const updatedAt = new Date(at).toISOString();
  const changed = [];
  const records = players.map((player) => {
    const isActive = String(player.UUID) === String(activePlayer.UUID);
    const next = {
      ...player,
      ...(isActive ? activePatch : {}),
      wakeChecklist: wake,
      sleepChecklist: sleep,
    };
    if (Object.keys(next).every((key) => JSON.stringify(next[key]) === JSON.stringify(player[key]))) return player;
    const record = { ...next, updatedAt, syncUpdatedAt: updatedAt };
    changed.push(record);
    return record;
  });
  if (!records.some((record) => String(record.UUID) === String(activePlayer.UUID))) {
    const record = {
      ...activePlayer,
      ...activePatch,
      wakeChecklist: wake,
      sleepChecklist: sleep,
      updatedAt,
      syncUpdatedAt: updatedAt,
    };
    records.push(record);
    changed.push(record);
  }
  if (changed.length) await databaseConnection.commitAtomicMutation({
    label: 'shared-ritual-settings',
    puts: changed.map((record) => ({ store: STORES.player, record })),
  });
  return records.find((record) => String(record.UUID) === String(activePlayer.UUID));
}

export async function convergeSharedRitualSettings(databaseConnection, activePlayer) {
  if (!activePlayer?.UUID || !databaseConnection?.getAll) return activePlayer || null;
  const players = await databaseConnection.getAll(STORES.player);
  const needsConvergence = players.some((player) => (
    !sameChecklist(player.wakeChecklist, activePlayer.wakeChecklist)
    || !sameChecklist(player.sleepChecklist, activePlayer.sleepChecklist)
  ));
  if (!needsConvergence) return activePlayer;
  return saveSharedRitualSettings(databaseConnection, activePlayer);
}

export default saveSharedRitualSettings;
