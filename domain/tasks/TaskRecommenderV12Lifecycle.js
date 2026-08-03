import {
  appendTaskRecommenderProtocolEvent,
  appendTaskRecommenderProtocolEvents,
} from './TaskRecommenderLedger.js';
import { isTaskRecommenderProtocolEvent } from './TaskRecommenderProtocol.js';
import { getTaskRecommenderV12MigrationState } from './TaskRecommenderV12RuntimeState.js';

export const TASK_RECOMMENDER_V12_LIFECYCLE_SCHEMA_VERSION = 4;

/**
 * Persists already-normalized v12 lifecycle facts. Active runtime code must
 * never submit obsolete recommendation records to this boundary.
 */
export function enqueueTaskRecommenderV12Lifecycle(databaseConnection, input = null) {
  if (!input) return Promise.resolve(null);
  if (Array.isArray(input)) {
    return appendTaskRecommenderProtocolEvents(databaseConnection, input);
  }
  if (Array.isArray(input.protocolInputs)) {
    return appendTaskRecommenderProtocolEvents(databaseConnection, input.protocolInputs);
  }
  if (isTaskRecommenderProtocolEvent(input)) {
    return appendTaskRecommenderProtocolEvent(databaseConnection, input);
  }
  if (input.type && input.decisionUUID && (input.playerUUID || input.parent)) {
    return appendTaskRecommenderProtocolEvent(databaseConnection, input);
  }
  throw new TypeError('v12 lifecycle input must be a protocol event or protocol input');
}

/**
 * Active recovery reads v12 state only. Old-format conversion has a separate,
 * explicitly requested lazy boundary.
 */
export async function recoverTaskRecommenderV12Lifecycle(databaseConnection, playerUUID) {
  const migration = await getTaskRecommenderV12MigrationState(databaseConnection, playerUUID);
  return Object.freeze({ migration });
}
