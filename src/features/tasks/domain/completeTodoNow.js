import { GAME_STATE } from '@domain/constants.js';
import { completeTask } from './TaskCompletionService.js';

/** Complete a queued todo immediately through the canonical completion service. */
export async function completeTodoNow({
  databaseConnection,
  todo,
  player = null,
  gameState = GAME_STATE.idle,
  dojoSessionUUID = null,
  notify = null,
  emitRewardEvent = null,
  source = 'quick-checklist',
  origin = 'desktop',
  enqueueSync = true,
} = {}) {
  return completeTask({
    databaseConnection,
    task: todo,
    player,
    gameState,
    dojoSessionUUID,
    source,
    origin,
    enqueueSync,
    completionMode: 'immediate',
    removeTodo: true,
    notify,
    emitRewardEvent,
  });
}

export default completeTodoNow;
