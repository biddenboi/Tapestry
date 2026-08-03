import { STORES } from '../../../domain/constants.js';
import { patchNextMoveDecision } from '../../../domain/navigation/NextMoveDecision.js';

function id() {
  return globalThis.crypto?.randomUUID?.()
    || `next-move-feedback:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function createNextMoveFeedback({
  decision,
  playerUUID,
  type,
  payload = {},
  createdAt = new Date().toISOString(),
} = {}) {
  if (!decision?.UUID || !playerUUID || !type) throw new Error('Feedback requires a decision, player, and type.');
  return Object.freeze({
    UUID: id(),
    parent: String(playerUUID),
    decisionId: decision.UUID,
    playerUUID: String(playerUUID),
    type,
    payload,
    createdAt,
    updatedAt: createdAt,
  });
}

export async function applyNextMoveFeedback({
  databaseConnection,
  decisionRepository,
  feedbackRepository,
  decision,
  playerUUID,
  type,
  payload = {},
} = {}) {
  const feedback = createNextMoveFeedback({ decision, playerUUID, type, payload });
  const taskUUID = decision.destination?.entityType === 'task'
    ? decision.destination.entityUUID
    : decision.sourceEntityRefs?.find((ref) => ref.type === 'task')?.UUID;
  const puts = [{ store: STORES.nextMoveFeedback, record: feedback }];
  if (type === 'need-plan' && taskUUID) {
    const task = await databaseConnection.get(STORES.todo, taskUUID);
    if (task) {
      puts.push({
        store: STORES.todo,
        record: {
          ...task,
          planEligible: true,
          needsPlanning: true,
          updatedAt: feedback.createdAt,
        },
      });
    }
  }
  if (type === 'not-important' && taskUUID) {
    const task = await databaseConnection.get(STORES.todo, taskUUID);
    if (task) {
      puts.push({
        store: STORES.todo,
        record: { ...task, optional: true, updatedAt: feedback.createdAt },
      });
    }
  }
  const decisionPatch = type === 'not-now'
    ? { dismissedAt: feedback.createdAt, outcome: 'suppressed' }
    : { correctedAt: feedback.createdAt, outcome: `corrected:${type}` };
  const updatedDecision = patchNextMoveDecision(decision, decisionPatch);
  puts.push({ store: STORES.nextMoveDecision, record: updatedDecision });
  if (typeof databaseConnection.commitAtomicMutation === 'function') {
    await databaseConnection.commitAtomicMutation({
      label: `next-move-feedback:${type}`,
      puts,
    });
  } else {
    await Promise.all([
      feedbackRepository.save(feedback),
      decisionRepository.save(updatedDecision),
      ...puts.slice(2).map(({ store, record }) => databaseConnection.add(store, record)),
    ]);
  }
  return { feedback, decision: updatedDecision };
}
