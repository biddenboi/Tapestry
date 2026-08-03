import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { getNormalizedActiveEffects } from '@domain/events/ActiveEffectsCache.js';

const isHabit = (event) => event?.type === 'habit' || event?.type === 'special';
const isQuantity = (event) => event?.type === 'quantity';

export async function loadHabitAndQuantityOverview(
  databaseConnection,
  currentPlayer,
  eventRevision = 0,
) {
  if (!databaseConnection || !currentPlayer?.UUID) {
    return { habits: [], quantities: [], logs: [], activeEffects: [] };
  }
  const viewerIGT = getCurrentIGT(currentPlayer);
  const [definitions, logs, activeEffects] = await Promise.all([
    databaseConnection.getAllCustomEvents(),
    databaseConnection.getAllThroughIGT(STORES.eventLog, viewerIGT),
    getNormalizedActiveEffects(databaseConnection, currentPlayer.UUID, eventRevision),
  ]);
  return {
    habits: (definitions || []).filter(isHabit),
    quantities: (definitions || []).filter(isQuantity),
    logs: logs || [],
    activeEffects,
  };
}

export async function loadEventAnalytics(databaseConnection, currentPlayer, eventUUID) {
  if (!databaseConnection || !currentPlayer?.UUID || !eventUUID) {
    return { logs: [], players: [] };
  }
  const viewerIGT = getCurrentIGT(currentPlayer);
  const [logs, players] = await Promise.all([
    databaseConnection.getEventLogsForEventThroughIGT(eventUUID, viewerIGT),
    databaseConnection.getPlayersAtIGT(viewerIGT, { includeArchived: false }),
  ]);
  return { logs: logs || [], players: players || [] };
}

export async function loadGoalArenaData(databaseConnection, currentPlayer) {
  if (!databaseConnection || !currentPlayer?.UUID) {
    return { goals: [], contributions: [], players: [] };
  }
  const viewerIGT = getCurrentIGT(currentPlayer);
  const [goals, contributions, players] = await Promise.all([
    databaseConnection.getAll(STORES.project),
    databaseConnection.getAllThroughIGT(STORES.contribution, viewerIGT),
    databaseConnection.getPlayersAtIGT(viewerIGT, { includeArchived: false }),
  ]);
  return {
    goals: goals || [],
    contributions: contributions || [],
    players: players || [],
  };
}
