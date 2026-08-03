import { STORES } from '@domain/constants.js';

export const NOTIFICATION_CATEGORY = Object.freeze({
  plannedOpportunity: 'planned-opportunity',
  externalDeadline: 'external-deadline',
  sharedAppointment: 'shared-appointment',
  resolvedBlocker: 'resolved-blocker',
  reentry: 'reentry',
});

export const DEFAULT_NOTIFICATION_POLICY = Object.freeze({
  maximumPerDay: 2,
  maximumRepeatPerAction: 1,
  dismissalCooldownMs: 24 * 60 * 60 * 1000,
  quietHoursStart: null,
  quietHoursEnd: null,
  categories: Object.freeze(Object.fromEntries(
    Object.values(NOTIFICATION_CATEGORY).map((category) => [category, true]),
  )),
});

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function policyForPlayer(player) {
  const supplied = player?.notificationPolicy || {};
  return {
    ...DEFAULT_NOTIFICATION_POLICY,
    ...supplied,
    categories: {
      ...DEFAULT_NOTIFICATION_POLICY.categories,
      ...(supplied.categories || {}),
    },
  };
}

function decisionUUID(playerUUID, candidate, now) {
  return `intervention:${playerUUID}:${candidate.type}:${candidate.targetUUID || 'none'}:${dayKey(now)}`;
}

export async function decideNotification(databaseConnection, player, candidate, {
  now = new Date(),
  activeSession = false,
  activeMatch = false,
  activeDojo = false,
  quietHours = false,
} = {}) {
  const policy = policyForPlayer(player);
  const decisions = await databaseConnection.getPlayerStore(STORES.interventionDecision, player.UUID);
  const today = dayKey(now);
  const todayDelivered = decisions.filter((row) => (
    row.decision === 'deliver'
    && row.deliveredAt
    && dayKey(new Date(row.deliveredAt)) === today
  ));
  const sameTarget = decisions.filter((row) => (
    row.candidateType === candidate.type
    && String(row.candidateTargetUUID || '') === String(candidate.targetUUID || '')
  ));
  const recentDismissals = sameTarget.filter((row) => (
    row.dismissedAt
    && now.getTime() - new Date(row.dismissedAt).getTime() < policy.dismissalCooldownMs
  ));
  const reasonCodes = [];
  if (!policy.categories[candidate.type]) reasonCodes.push('category-disabled');
  if (activeSession || activeMatch || activeDojo) reasonCodes.push('meaningful-session-active');
  if (quietHours) reasonCodes.push('quiet-hours');
  if (todayDelivered.length >= policy.maximumPerDay) reasonCodes.push('daily-budget-exhausted');
  if (sameTarget.filter((row) => row.deliveredAt).length >= policy.maximumRepeatPerAction) {
    reasonCodes.push('action-repeat-limit');
  }
  if (recentDismissals.length) reasonCodes.push('dismissal-cooldown');
  if (candidate.isPossibleNow === false) reasonCodes.push('action-not-possible');
  if (!candidate.specificAction) reasonCodes.push('no-specific-action');
  const decision = reasonCodes.length ? 'suppress' : 'deliver';
  if (!reasonCodes.length) reasonCodes.push('specific-feasible-opportunity');
  const at = now.toISOString();
  const record = {
    UUID: decisionUUID(player.UUID, candidate, now),
    parent: player.UUID,
    decisionPoint: candidate.decisionPoint || 'proactive-reminder',
    contextSnapshot: {
      activeSession,
      activeMatch,
      activeDojo,
      quietHours,
      dailyDelivered: todayDelivered.length,
    },
    candidateType: candidate.type,
    candidateTargetUUID: candidate.targetUUID || null,
    decision,
    reasonCodes,
    deliveredAt: decision === 'deliver' ? at : null,
    dismissedAt: null,
    openedAt: null,
    actionStartedAt: null,
    userRating: null,
    createdAt: at,
  };
  const existing = await databaseConnection.get(STORES.interventionDecision, record.UUID);
  if (!existing) {
    await databaseConnection.add(STORES.interventionDecision, record);
    return record;
  }
  // A historical delivery stays in the ledger, while current session/privacy
  // context can still suppress its visible presentation.
  if (decision === 'suppress') {
    return {
      ...existing,
      decision: 'suppress',
      reasonCodes,
      contextSnapshot: record.contextSnapshot,
      suppressedAt: at,
    };
  }
  if (existing.decision === 'suppress') {
    const delivered = {
      ...existing,
      ...record,
      createdAt: existing.createdAt,
    };
    await databaseConnection.add(STORES.interventionDecision, delivered);
    return delivered;
  }
  return existing;
}

export async function markInterventionOutcome(databaseConnection, decisionUUIDValue, patch = {}) {
  if (!decisionUUIDValue) return null;
  const record = await databaseConnection.get(STORES.interventionDecision, decisionUUIDValue);
  if (!record) return null;
  const next = {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await databaseConnection.add(STORES.interventionDecision, next);
  return next;
}

export function explainNotificationDecision(decision) {
  if (!decision) return 'This prompt corresponds to a specific opportunity you allowed.';
  if (decision.reasonCodes?.includes('specific-feasible-opportunity')) {
    return 'A specific action you planned is possible now, and today’s prompt budget is still available.';
  }
  return `Policy: ${(decision.reasonCodes || []).join(', ') || 'no delivery reason recorded'}.`;
}
