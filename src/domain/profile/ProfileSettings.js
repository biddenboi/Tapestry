import { STORES } from '@domain/constants.js';
import { queueProfileWrite } from '@domain/profile/ProfileWriteQueue.js';

export function saveProfileSettings(databaseConnection, player, { activePatch = {}, at = new Date() } = {}) {
  return queueProfileWrite(databaseConnection, async () => {
    const players = await databaseConnection.getAll(STORES.player);
    const latest = players.find((entry) => String(entry.UUID) === String(player.UUID)) || player;
    const updatedAt = new Date(at).toISOString();
    const record = { ...latest, ...activePatch, updatedAt, syncUpdatedAt: updatedAt };
    await databaseConnection.commitAtomicMutation({
      label: 'profile-settings',
      puts: [{ store: STORES.player, record }],
    });
    return record;
  });
}
