import { STORES } from '../constants.js';
import { normalizeRitualChecklist } from './Events.js';

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

export async function saveSharedRitualSettings(databaseConnection, activePlayer, {
  activePatch = {},
  wakeChecklist = activePatch.wakeChecklist ?? activePlayer?.wakeChecklist,
  sleepChecklist = activePatch.sleepChecklist ?? activePlayer?.sleepChecklist,
  at = new Date(),
} = {}) {
  if (!databaseConnection?.commitAtomicMutation || !activePlayer?.UUID) {
    throw new TypeError('Shared ritual settings require an active profile and database connection.');
  }
  const players = await databaseConnection.getAll(STORES.player);
  const wake = normalizeRitualChecklist(wakeChecklist);
  const sleep = normalizeRitualChecklist(sleepChecklist);
  const updatedAt = new Date(at).toISOString();
  const records = players.map((player) => {
    const isActive = String(player.UUID) === String(activePlayer.UUID);
    return {
      ...player,
      ...(isActive ? activePatch : {}),
      wakeChecklist: wake,
      sleepChecklist: sleep,
      updatedAt,
      syncUpdatedAt: updatedAt,
    };
  });
  if (!records.some((record) => String(record.UUID) === String(activePlayer.UUID))) {
    records.push({
      ...activePlayer,
      ...activePatch,
      wakeChecklist: wake,
      sleepChecklist: sleep,
      updatedAt,
      syncUpdatedAt: updatedAt,
    });
  }
  await databaseConnection.commitAtomicMutation({
    label: 'shared-ritual-settings',
    puts: records.map((record) => ({ store: STORES.player, record })),
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
