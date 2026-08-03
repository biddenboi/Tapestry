import { STORES, GAME_STATE } from '@domain/constants.js';
import { getAchievementByKey } from '@domain/achievements/Achievements.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  processAchievementEvent,
  recordAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import { recordActionContribution, recordTaskContribution } from '@domain/contribution/Contribution.js';
import { recordTaskRecommendationSessionResult } from '@domain/tasks/TaskRecommender.js';
import { recordRewardProvenance } from '@domain/rewards/RewardProvenance.js';
import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';

export const TASK_COMPLETION_PROCESSOR_VERSION = 1;

const inFlightByConnection = new WeakMap();

function processorReceiptUUID(completionEventUUID, processor) {
  return `${completionEventUUID}:${processor}`;
}

function taskCompletionLock(databaseConnection, completionEventUUID) {
  let locks = inFlightByConnection.get(databaseConnection);
  if (!locks) {
    locks = new Map();
    inFlightByConnection.set(databaseConnection, locks);
  }
  return { locks, key: completionEventUUID };
}

async function writeReceipt(databaseConnection, event, processor, status, extra = {}) {
  const now = new Date().toISOString();
  const UUID = processorReceiptUUID(event.UUID, processor);
  const previous = await databaseConnection.get(STORES.taskCompletionReceipt, UUID).catch(() => null);
  await databaseConnection.add(STORES.taskCompletionReceipt, {
    UUID,
    parent: event.parent,
    completionEventUUID: event.UUID,
    taskUUID: event.taskUUID,
    processor,
    processorVersion: TASK_COMPLETION_PROCESSOR_VERSION,
    status,
    attempts: Math.max(0, Number(previous?.attempts) || 0) + 1,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    completedAt: status === 'completed' ? now : null,
    ...extra,
  });
}

async function runIdempotentProcessor(databaseConnection, event, processor, operation) {
  const receiptId = processorReceiptUUID(event.UUID, processor);
  const existing = await databaseConnection.get(STORES.taskCompletionReceipt, receiptId);
  if (existing?.status === 'completed') {
    return { processor, status: 'already-completed', result: existing.result || null };
  }
  try {
    const result = await operation();
    await writeReceipt(databaseConnection, event, processor, 'completed', {
      result: result == null ? null : result,
      error: null,
    });
    return { processor, status: 'completed', result };
  } catch (error) {
    await writeReceipt(databaseConnection, event, processor, 'failed', {
      error: String(error?.message || error),
    }).catch(() => undefined);
    throw error;
  }
}

async function ensureProcessorDomains(databaseConnection, domains) {
  if (!databaseConnection?.ensureDomainsLoaded) return;
  await databaseConnection.ensureDomainsLoaded(domains);
}

function contributionReward(event, reward) {
  if (reward) return reward;
  return {
    coins: Number(event.reward?.coins) || 0,
    contribution: Number(event.reward?.contribution) || 0,
    bandId: event.reward?.bandId || null,
    rarity: event.reward?.rarity || null,
    label: event.reward?.label || null,
  };
}

/** Run all secondary effects for one authoritative completion event. */
export async function processTaskCompletionEvent(databaseConnection, eventOrId, context = {}) {
  if (!databaseConnection || !eventOrId) return [];
  const event = typeof eventOrId === 'string'
    ? await databaseConnection.get(STORES.taskCompletionEvent, eventOrId)
    : eventOrId;
  if (!event?.UUID || !event.taskUUID || !event.parent) return [];

  const { locks, key } = taskCompletionLock(databaseConnection, event.UUID);
  if (locks.has(key)) return locks.get(key);

  const operation = (async () => {
    const task = context.task || await databaseConnection.get(STORES.task, event.taskUUID);
    const player = context.player || await databaseConnection.get(STORES.player, event.parent);
    if (!task || !player) throw new Error(`Completion ${event.UUID} is missing its task or player record.`);
    const reward = contributionReward(event, context.reward);
    const results = [];

    const contributionResult = await runIdempotentProcessor(
      databaseConnection,
      event,
      'contributions',
      async () => {
        const contribution = await recordTaskContribution(databaseConnection, player, task, reward, {
          completionEventUUID: event.UUID,
        });
        if (contribution && Number(contribution.value || 0) !== 0) {
          await recordRewardProvenance(databaseConnection, {
            playerUUID: player.UUID,
            sourceEventUUID: event.actionSessionUUID || event.UUID,
            sourceType: event.actionSessionUUID ? 'action-session' : 'task-completion',
            rewardType: 'contribution',
            amount: contribution.value,
            explanation: 'Eligible task effort settled under the continuity task policy.',
            issuedAt: event.completedAt || event.createdAt,
          });
        }
        return contribution;
      },
    );
    results.push(contributionResult);

    if (event.gameState === GAME_STATE.dojo) {
      results.push(await runIdempotentProcessor(
        databaseConnection,
        event,
        'dojo-leaderboard',
        async () => {
          await ensureProcessorDomains(databaseConnection, ['leaderboards']);
          const standings = await databaseConnection.recordDojoStandingCompletion?.({ task, event, player });
          return { standings };
        },
      ));
      results.push(await runIdempotentProcessor(
        databaseConnection,
        event,
        'dojo-contribution',
        async () => {
          const durationContribution = Math.max(1, Math.round(Math.max(0, Number(event.durationMs) || 0) / (30 * 60 * 1000)));
          return recordActionContribution(databaseConnection, player, {
            source: 'dojo',
            sourceUUID: event.UUID,
            value: durationContribution,
            summary: `Dojo work: ${task.name || 'Completed task'}`,
            taskUUID: task.UUID,
            todoUUID: task.todoUUID || null,
            completionEventUUID: null,
            createdAt: event.completedAt,
            inGameTimestamp: task.completedInGameTimestamp ?? task.inGameTimestamp ?? null,
          });
        },
      ));
    }

    const achievementResult = await runIdempotentProcessor(
      databaseConnection,
      event,
      'achievements',
      async () => {
        await ensureProcessorDomains(databaseConnection, ['achievements']);
        const achievementEvent = createAchievementEvent({
          type: ACHIEVEMENT_EVENT_TYPE.taskCompleted,
          parent: player.UUID,
          sourceUUID: event.UUID,
          occurredAt: event.completedAt,
          payload: {
            taskUUID: event.taskUUID,
            completedAt: event.completedAt,
            durationMs: event.durationMs,
            durationEvidence: event.durationEvidence || null,
            durationVerified: ['action-session', 'explicit-start'].includes(event.durationEvidence),
            outcome: 'completed',
            points: getCanonicalTaskPoints(task),
            source: task.source || event.source || event.gameState,
          },
        });
        await recordAchievementEvent(databaseConnection, achievementEvent);
        const processed = await processAchievementEvent(databaseConnection, achievementEvent);
        return processed.earned || [];
      },
    );
    results.push(achievementResult);

    if (event.recommendation?.eventUUID) {
      results.push(await runIdempotentProcessor(
        databaseConnection,
        event,
        'recommender-outcome',
        async () => {
          await ensureProcessorDomains(databaseConnection, ['recommender']);
          const completionOccurredAt = event.completedAt
            || event.createdAt
            || new Date().toISOString();
          return recordTaskRecommendationSessionResult(
            databaseConnection,
            event.recommendation.eventUUID,
            {
              suggestedMinutes: event.recommendation.suggestedMinutes,
              acceptedMinutes: event.recommendation.acceptedMinutes,
              committedMs: event.committedMs,
              actualMs: event.durationMs,
              sessionStartedAt: new Date(
                new Date(completionOccurredAt).getTime()
                  - Math.max(0, Number(event.durationMs) || 0),
              ).toISOString(),
              sessionFinishedAt: completionOccurredAt,
              completedAt: completionOccurredAt,
              completed: event.recommendation.completed,
              completedTaskUUID: event.taskUUID,
              completionEventUUID: event.UUID,
              reason: event.recommendation.completed ? 'commitment-met' : 'commitment-not-met',
            },
          );
        },
      ));
    }

    const contribution = contributionResult.status === 'completed' ? contributionResult.result : null;
    const contributionGains = [
      contribution && Number(contribution.value || 0) !== 0
        ? { amount: contribution.value, unit: 'contribution', kind: 'contribution' }
        : null,
    ].filter(Boolean);
    if (contributionGains.length) {
      context.emitRewardEvent?.(contributionGains, {
        source: 'task-results',
        completionEventUUID: event.UUID,
      });
    }
    const achievementKeys = achievementResult.status === 'completed' && Array.isArray(achievementResult.result)
      ? achievementResult.result
      : [];
    const achievementGains = achievementKeys
      .map((key) => getAchievementByKey(key))
      .filter(Boolean)
      .map((achievement) => ({ label: `Achievement: ${achievement.label}`, kind: 'contribution' }));
    if (achievementGains.length) {
      context.emitRewardEvent?.(achievementGains, {
        source: 'task-results',
        completionEventUUID: event.UUID,
      });
    }
    if (contribution && context.notify) {
      context.notify({
        title: `${Number(contribution.value || 0) >= 0 ? '+' : ''}${Number(contribution.value || 0)} Contribution`,
        message: contribution.goalNameSnapshot
          ? `${contribution.goalNameSnapshot} advanced through completed work.`
          : 'Overall reputation increased through completed work.',
        kind: 'success',
        persist: false,
      });
    }

    return results;
  })().finally(() => locks.delete(key));

  locks.set(key, operation);
  return operation;
}

export function queueTaskCompletionSecondaryProcessing(databaseConnection, event, context = {}) {
  const queued = Promise.resolve().then(() => processTaskCompletionEvent(databaseConnection, event, context));
  queued.catch((error) => {
    console.warn('[TaskCompletionProcessors] secondary processing failed:', error);
  });
  return queued;
}

/** Resume durable completion events after the Tasks domain is opened. */
export async function recoverPendingTaskCompletionProcessing(databaseConnection, context = {}) {
  if (!databaseConnection) return [];
  const events = await databaseConnection.getAll(STORES.taskCompletionEvent);
  const ordered = [...events].sort((left, right) => (
    String(left.completedAt || left.createdAt || '').localeCompare(String(right.completedAt || right.createdAt || ''))
    || String(left.UUID).localeCompare(String(right.UUID))
  ));
  const results = [];
  for (const event of ordered) {
    const recoveryProcessor = `recovery-v${TASK_COMPLETION_PROCESSOR_VERSION}`;
    const recoveryReceiptId = processorReceiptUUID(event.UUID, recoveryProcessor);
    // A versioned terminal marker prevents every startup from replaying the
    // entire immutable completion ledger. A future processor-version bump gets
    // its own marker and therefore still performs the intended backfill.
    // eslint-disable-next-line no-await-in-loop
    const existingRecovery = await databaseConnection.get(
      STORES.taskCompletionReceipt,
      recoveryReceiptId,
    ).catch(() => null);
    if (existingRecovery?.status === 'completed') {
      results.push([{ processor: recoveryProcessor, status: 'already-completed' }]);
      continue;
    }

    // Imported or pruned ledgers can legitimately contain completion evidence
    // whose task/profile record no longer exists. Record that terminal outcome
    // once instead of logging and retrying the same orphan forever.
    // eslint-disable-next-line no-await-in-loop
    const [task, player] = await Promise.all([
      databaseConnection.get(STORES.task, event.taskUUID),
      databaseConnection.get(STORES.player, event.parent),
    ]);
    if (!task || !player) {
      const outcome = {
        outcome: 'orphaned',
        missingTask: !task,
        missingPlayer: !player,
      };
      // eslint-disable-next-line no-await-in-loop
      await writeReceipt(databaseConnection, event, recoveryProcessor, 'completed', {
        result: outcome,
        error: null,
      });
      results.push([{ processor: recoveryProcessor, status: 'completed', result: outcome }]);
      continue;
    }

    // Sequential replay avoids derived systems racing over shared player state.
    // eslint-disable-next-line no-await-in-loop
    const processed = await processTaskCompletionEvent(databaseConnection, event, {
      ...context,
      task,
      player,
    });
    // eslint-disable-next-line no-await-in-loop
    await writeReceipt(databaseConnection, event, recoveryProcessor, 'completed', {
      result: { outcome: 'processed' },
      error: null,
    });
    results.push(processed);
  }
  return results;
}

export { processorReceiptUUID };
