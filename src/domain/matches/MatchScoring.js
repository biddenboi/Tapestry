import { STORES } from '@domain/constants.js';
import { getMatchRules, PAIR_MATCH_RULESET_ID } from './MatchContracts.js';
import { calculateMatchPromiseScore } from './MatchPromiseReward.js';

const LEGACY_SCORE_VISIBILITY = Object.freeze({
  live: 'live',
  checkpoint: 'checkpoint',
  finalOnly: 'final-only',
});

export function actionMatchesEligibleScope(match, evidence = {}) {
  const rules = getMatchRules(match);
  const goalIds = new Set(rules.eligibleGoalUUIDs || []);
  const milestoneIds = new Set(rules.eligibleMilestoneUUIDs || []);
  const taskIds = new Set(rules.eligibleTaskUUIDs || []);
  const scopeEmpty = !goalIds.size && !milestoneIds.size && !taskIds.size;
  if (scopeEmpty) return { eligible: true, ruleId: 'open-scope' };
  if (evidence.goalUUID && goalIds.has(evidence.goalUUID)) {
    return { eligible: true, ruleId: `goal:${evidence.goalUUID}` };
  }
  if (evidence.milestoneUUID && milestoneIds.has(evidence.milestoneUUID)) {
    return { eligible: true, ruleId: `milestone:${evidence.milestoneUUID}` };
  }
  if (evidence.targetUUID && taskIds.has(evidence.targetUUID)) {
    return { eligible: true, ruleId: `task:${evidence.targetUUID}` };
  }
  if (rules.allowNewLinkedTasks && evidence.goalUUID && goalIds.has(evidence.goalUUID)) {
    return { eligible: true, ruleId: `linked-goal:${evidence.goalUUID}` };
  }
  return { eligible: false, ruleId: 'outside-eligible-scope' };
}

export function createMatchScoreEvent({
  match,
  participantUUID,
  actionSession,
  taskCompletionEventUUID = null,
  points,
  scoreBreakdown = null,
  occurredAt = new Date().toISOString(),
} = {}) {
  if (!match?.UUID || !participantUUID || !actionSession?.UUID) return null;
  const eligibility = actionMatchesEligibleScope(match, {
    targetUUID: actionSession.targetUUID,
    goalUUID: actionSession.goalUUID,
    milestoneUUID: actionSession.milestoneUUID,
  });
  if (!eligibility.eligible) return null;
  return Object.freeze({
    UUID: `match-score:${match.UUID}:${participantUUID}:${actionSession.UUID}`,
    parent: participantUUID,
    matchUUID: match.UUID,
    participantUUID,
    actionSessionUUID: actionSession.UUID,
    taskCompletionEventUUID,
    eligibleRuleId: eligibility.ruleId,
    points: Math.max(0, Math.floor(Number(points) || 0)),
    occurredAt,
    createdAt: occurredAt,
    evidence: {
      outcome: actionSession.outcome,
      targetType: actionSession.targetType,
      targetUUID: actionSession.targetUUID,
      targetName: actionSession.targetName || null,
      goalUUID: actionSession.goalUUID,
      milestoneUUID: actionSession.milestoneUUID,
      matchReward: scoreBreakdown ? { ...scoreBreakdown } : null,
    },
  });
}

export async function finalizeMatchActionSessionScore(databaseConnection, {
  match,
  participantUUID,
  actionSession,
  activeDurationMs,
  boundaryAt = new Date().toISOString(),
  operationId: requestedOperationId = null,
  origin = 'desktop',
  enqueueSync = true,
} = {}) {
  if (!databaseConnection || !match?.UUID || !participantUUID || !actionSession?.UUID) return null;
  if (String(actionSession.matchUUID || '') !== String(match.UUID)) return null;
  const eventUUID = `match-score:${match.UUID}:${participantUUID}:${actionSession.UUID}`;
  const existingEvent = await databaseConnection.get(STORES.matchScoreEvent, eventUUID).catch(() => null);
  if (actionSession.matchScoreFinalizedAt || existingEvent) {
    const persistedSession = await databaseConnection.get(STORES.actionSession, actionSession.UUID).catch(() => null);
    const finalizedSession = persistedSession || (existingEvent ? {
      ...actionSession,
      matchScoreFinalizedAt: existingEvent.occurredAt || actionSession.matchScoreFinalizedAt || null,
      matchScoreEventUUID: existingEvent.UUID,
      matchScoreBreakdown: existingEvent.evidence?.matchReward || actionSession.matchScoreBreakdown || null,
    } : actionSession);
    return Object.freeze({
      actionSession: finalizedSession,
      scoreEvent: existingEvent,
      scoreBreakdown: existingEvent?.evidence?.matchReward || finalizedSession.matchScoreBreakdown || null,
      duplicate: true,
    });
  }
  const normalizedBoundary = new Date(boundaryAt).toISOString();
  const scoreBreakdown = actionSession.matchRewardContract
    ? calculateMatchPromiseScore({
        contract: actionSession.matchRewardContract,
        activeDurationMs,
        boundaryAt: normalizedBoundary,
        activityIntervals: actionSession.activityIntervals || [],
      })
    : {
        policyId: 'legacy-time-only',
        policyVersion: 0,
        boundaryAt: normalizedBoundary,
        eligibleActiveMs: Math.max(0, Number(activeDurationMs) || 0),
        basePoints: Math.floor(Math.max(0, Number(activeDurationMs) || 0) / 10_000),
        taskMultiplier: 1,
        eventMultiplier: 1,
        promisedMs: 0,
        promiseRatio: 0,
        promiseMet: false,
        promiseScalar: 1,
        totalMultiplier: 1,
        points: Math.floor(Math.max(0, Number(activeDurationMs) || 0) / 10_000),
      };
  const scoreEvent = createMatchScoreEvent({
    match,
    participantUUID,
    actionSession,
    points: scoreBreakdown?.points || 0,
    scoreBreakdown,
    occurredAt: normalizedBoundary,
  });
  const finalizedSession = {
    ...actionSession,
    matchScoreFinalizedAt: normalizedBoundary,
    matchScoreEventUUID: scoreEvent?.UUID || null,
    matchScoreBreakdown: scoreBreakdown,
    updatedAt: normalizedBoundary,
  };
  const operationId = requestedOperationId || `match-score-finalize:${eventUUID}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: `match-session-score-finalize:${match.UUID}`,
    puts: [
      { store: STORES.actionSession, record: finalizedSession },
      scoreEvent ? { store: STORES.matchScoreEvent, record: scoreEvent } : null,
    ].filter(Boolean),
    sync: databaseConnection.createSyncCommandContext?.({
      origin,
      enqueueSync,
      operationId,
      playerId: participantUUID,
      commandType: 'finalizeMatchActionSessionScore',
      entityType: 'match-score-event',
      entityId: eventUUID,
      payload: {
        matchId: match.UUID,
        participantId: participantUUID,
        actionSessionId: actionSession.UUID,
        boundaryAt: normalizedBoundary,
        activeDurationMs: Math.max(0, Number(activeDurationMs) || 0),
        actionSession: finalizedSession,
        scoreEvent,
      },
      occurredAt: normalizedBoundary,
    }) || { origin, enqueueSync: false },
  });
  return Object.freeze({
    actionSession: finalizedSession,
    scoreEvent,
    scoreBreakdown,
    duplicate: false,
  });
}

export async function recordMatchScoreEvent(databaseConnection, input) {
  const event = createMatchScoreEvent(input);
  if (!event) return null;
  const existing = await databaseConnection.get(STORES.matchScoreEvent, event.UUID);
  if (existing) return existing;
  const operationId = input.operationId || `match-score-record:${event.UUID}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'match-score-event-record',
    puts: [{ store: STORES.matchScoreEvent, record: event }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin: input.origin || 'desktop',
      enqueueSync: input.enqueueSync !== false,
      operationId,
      playerId: event.participantUUID,
      commandType: 'recordMatchScoreEvent',
      entityType: 'match-score-event',
      entityId: event.UUID,
      payload: event,
      occurredAt: event.occurredAt,
    }) || { origin: input.origin || 'desktop', enqueueSync: false },
  });
  return event;
}

export function reconstructMatchScores(events = [], matchUUID = null) {
  return events.reduce((scores, event) => {
    if (matchUUID && String(event.matchUUID) !== String(matchUUID)) return scores;
    if (!event.participantUUID || Number(event.points) <= 0) return scores;
    scores[event.participantUUID] = (scores[event.participantUUID] || 0) + Number(event.points);
    return scores;
  }, {});
}

export function matchScoreIsVisible(match, now = Date.now(), { final = false } = {}) {
  if (final || match?.status !== 'active') return true;
  const rules = getMatchRules(match);
  if (rules.rulesetId === PAIR_MATCH_RULESET_ID) return true;
  if (rules.scoreVisibility === LEGACY_SCORE_VISIBILITY.live) return true;
  if (rules.scoreVisibility === LEGACY_SCORE_VISIBILITY.finalOnly) return false;
  const interval = Math.max(1, Number(rules.checkpointIntervalMs) || 30 * 60 * 1000);
  const elapsed = Math.max(0, Number(now) - new Date(match.createdAt).getTime());
  return elapsed > 0 && elapsed % interval < 10_000;
}
