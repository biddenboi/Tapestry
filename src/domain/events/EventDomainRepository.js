import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';

const TRACKER_TYPES = new Set(['one_time', 'quantity', 'duration']);

export async function loadTrackerOverview(
  databaseConnection,
  currentPlayer,
) {
  if (!databaseConnection || !currentPlayer?.UUID) {
    return { trackers: [], logs: [] };
  }
  const viewerIGT = getCurrentIGT(currentPlayer);
  const [definitions, logs] = await Promise.all([
    databaseConnection.getAllCustomEvents(),
    databaseConnection.getAllThroughIGT(STORES.eventLog, viewerIGT),
  ]);
  const trackers = (definitions || []).filter((event) => TRACKER_TYPES.has(event?.type));
  const trackerIds = new Set(trackers.map((event) => String(event.UUID)));
  return {
    trackers,
    logs: (logs || []).filter((log) => trackerIds.has(String(log.eventUUID))),
  };
}

export async function loadGoalArenaData(databaseConnection, currentPlayer) {
  if (!databaseConnection || !currentPlayer?.UUID) {
    return {
      areas: [],
      currentFocusGoalUUID: null,
      activeGoals: [],
      pausedGoals: [],
      completedGoals: [],
      attentionItems: [],
      recentMilestones: [],
      summary: {
        activeCount: 0,
        blockedCount: 0,
        completedThisMonth: 0,
        recentContribution: 0,
      },
    };
  }
  const viewerIGT = getCurrentIGT(currentPlayer);
  return databaseConnection.getRepository('goals').getOverview(
    currentPlayer.UUID,
    viewerIGT,
  );
}
