import { STORES } from '@domain/constants.js';
import {
  projectContributionLeaderboardAtIGT,
  projectMatchLeaderboardAtIGT,
  readMaterializedLeaderboardSnapshotsSWR,
} from '@domain/leaderboards/MaterializedLeaderboards.js';
import { buildMobileCompetitionPresentation } from '@features/profile/mobile/MobileCompetitionPresentation.js';

export async function queryMobileCompetition(databaseConnection, {
  playerUUID,
  viewerIGT = Infinity,
} = {}) {
  if (!databaseConnection || !playerUUID) {
    throw new TypeError('Mobile competition requires a database connection and active profile.');
  }
  await databaseConnection.reconcileMissingMaterializedLeaderboards?.({
    reason: 'mobile-competition-read',
    force: true,
  });
  const [profiles, snapshots, notifications] = await Promise.all([
    databaseConnection.getAllPlayers?.({ includeArchived: true, includeBanned: false })
      || databaseConnection.getAll(STORES.player),
    readMaterializedLeaderboardSnapshotsSWR(databaseConnection),
    databaseConnection.getPlayerStore(STORES.notification, playerUUID),
  ]);
  const matchProjection = projectMatchLeaderboardAtIGT(snapshots.match, {
    viewerIGT,
    playerUUID,
  });
  const contributionProjection = projectContributionLeaderboardAtIGT(
    snapshots.contribution,
    { viewerIGT },
  );
  return Object.freeze({
    ...buildMobileCompetitionPresentation({
      profiles,
      matchSnapshot: snapshots.match,
      contributionSnapshot: contributionProjection,
      matchProjection,
      currentPlayerUUID: playerUUID,
    }),
    unreadNotifications: notifications.filter((item) => !item.readAt).length,
    snapshotsStale: Boolean(snapshots.stale),
  });
}

export default queryMobileCompetition;
