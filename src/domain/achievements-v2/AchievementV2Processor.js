import {
  ACHIEVEMENT_DEFINITIONS_V2,
  ACHIEVEMENT_V2_BY_ID,
} from './AchievementCatalogV2.js';
import AchievementV2Repository from '@data/persistence/repositories/AchievementV2Repository.js';
import { STORES } from '@domain/constants.js';

export const ACHIEVEMENT_V2_PROCESSOR_VERSION = 2;

const EVENT_DOMAIN = Object.freeze({
  'task-completed': 'tasks',
  'match-completed': 'competition',
  'journal-saved': 'chronicle',
  'timeline-event-created': 'history',
  'event-logged': 'rhythms',
  'inventory-changed': 'collection',
  'economy-logged': 'economy',
  'social-changed': 'community',
  'profile-updated': 'profile',
  'milestone-completed': 'goals',
  'goal-completed': 'goals',
  'goal-reviewed': 'goals',
  'retrospective-action': 'chronicle',
  'semantic-response': 'community',
  'story-updated': 'chronicle',
  'theme-applied': 'appearance',
  'era-transitioned': 'history',
  'project-evidence-updated': 'goals',
  'shared-history-updated': 'community',
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function increment(progress, key, amount = 1) {
  return { ...progress, [key]: Math.max(0, finite(progress[key]) + amount) };
}

function updateMaximum(progress, key, value) {
  return { ...progress, [key]: Math.max(finite(progress[key]), finite(value)) };
}

function addUnique(progress, key, value) {
  const values = new Set(Array.isArray(progress[key]) ? progress[key] : []);
  if (value) values.add(String(value));
  return { ...progress, [key]: [...values].sort() };
}

function evidence(event, extra = {}) {
  return {
    eventType: event.type,
    sourceUUID: event.sourceUUID || null,
    occurredAt: event.occurredAt || event.createdAt || null,
    ...extra,
  };
}

function meetsFirstStage(definition, value = 1) {
  return value >= finite(definition?.stages?.[0], 1);
}

function taskCandidates(event) {
  if (event.type !== 'task-completed') return [];
  const payload = event.payload || {};
  const outcome = payload.outcome || (payload.completed === false ? 'progressed' : 'completed');
  const minutes = Math.max(0, finite(payload.durationMs) / 60000);
  const candidates = [{
    id: 'first_movement',
    eligible: ['completed', 'progressed', 'blocked', 'stopped'].includes(outcome),
    snapshot: evidence(event, { outcome, minutes }),
  }, {
    id: 'focused_work',
    eligible: payload.durationVerified === true
      && minutes >= 45
      && ['completed', 'progressed'].includes(outcome),
    progress: (prior) => updateMaximum(prior, 'bestMinutes', minutes),
    value: minutes,
    snapshot: evidence(event, { outcome, minutes, trustworthy: true }),
  }, {
    id: 'clear_next_step',
    eligible: Boolean(payload.returnedToSavedNextAction || payload.resumedSavedNextAction),
    progress: (prior) => increment(prior, 'successfulContinuations'),
    valueKey: 'successfulContinuations',
    snapshot: evidence(event, { resumedSavedNextAction: true }),
  }, {
    id: 'return_path',
    eligible: Boolean(payload.returnedAfterInterruption && ['completed', 'progressed'].includes(outcome)),
    progress: (prior) => increment(prior, 'successfulReturns'),
    valueKey: 'successfulReturns',
    snapshot: evidence(event, { returnedAfterInterruption: true, outcome }),
  }, {
    id: 'thread_keeper',
    eligible: Boolean(payload.resumedPreservedThread),
    progress: (prior) => increment(prior, 'preservedThreads'),
    valueKey: 'preservedThreads',
    snapshot: evidence(event, { resumedPreservedThread: true }),
  }, {
    id: 'recovery',
    eligible: Boolean(payload.resolvedPreviousInterruption || payload.resolvedPreviousBlocker),
    progress: (prior) => increment(prior, 'resolvedInterruptions'),
    valueKey: 'resolvedInterruptions',
    snapshot: evidence(event, { resolvedPreviousInterruption: true }),
  }, {
    id: 'difficult_start',
    eligible: Boolean(payload.resistanceRecordedBeforeSession && ['completed', 'progressed'].includes(outcome)),
    snapshot: evidence(event, { resistanceRecordedBeforeSession: true, outcome }),
  }, {
    id: 'unblocked',
    eligible: Boolean(payload.resolvedPreviousBlocker),
    progress: (prior) => increment(prior, 'resolvedBlockers'),
    valueKey: 'resolvedBlockers',
    snapshot: evidence(event, { resolvedPreviousBlocker: true }),
  }, {
    id: 'long_work',
    eligible: Boolean(payload.formallyResolved && finite(payload.meaningfulSessionCount) >= 3),
    snapshot: evidence(event, { meaningfulSessionCount: finite(payload.meaningfulSessionCount) }),
  }, {
    id: 'early_groundwork',
    eligible: Boolean(
      payload.meaningfulProgress
      && payload.deadlineTrustworthy
      && finite(payload.daysBeforeDeadline) >= Math.max(3, finite(payload.earlyGroundworkThresholdDays, 7)),
    ),
    snapshot: evidence(event, {
      daysBeforeDeadline: finite(payload.daysBeforeDeadline),
      deadlineUUID: payload.deadlineUUID || null,
    }),
  }, {
    id: 'builder',
    eligible: Boolean(
      payload.projectUUID
      && finite(payload.substantialProjectTaskCount) >= 3
      && payload.milestoneCompleted,
    ),
    snapshot: evidence(event, {
      projectUUID: payload.projectUUID,
      substantialProjectTaskCount: finite(payload.substantialProjectTaskCount),
      milestoneUUID: payload.milestoneUUID || null,
    }),
  }];
  return candidates;
}

function matchCandidates(event) {
  if (event.type !== 'match-completed') return [];
  const payload = event.payload || {};
  const won = Boolean(payload.won);
  const margin = Math.abs(finite(payload.scoreMargin));
  const deficit = Math.max(0, finite(payload.maxDeficitRecovered));
  return [{
    id: 'first_rated_match',
    eligible: payload.fixedRuleset !== false && payload.settled !== false,
    snapshot: evidence(event, { fixedRuleset: true, settled: true }),
  }, {
    id: 'underdog',
    eligible: won && (finite(payload.expectedWinProbability, 1) <= 0.4 || finite(payload.opponentRankAdvantage) >= 1),
    snapshot: evidence(event, {
      won,
      expectedWinProbability: payload.expectedWinProbability ?? null,
      opponentRankAdvantage: finite(payload.opponentRankAdvantage),
    }),
  }, {
    id: 'clutch',
    eligible: won && margin > 0 && margin <= Math.max(3, finite(payload.clutchMarginThreshold, 3)),
    snapshot: evidence(event, { won, margin }),
  }, {
    id: 'comeback',
    eligible: won && deficit >= Math.max(3, finite(payload.comebackThreshold, 3)),
    snapshot: evidence(event, { won, maxDeficitRecovered: deficit }),
  }, {
    id: 'pair_bond',
    eligible: Boolean(payload.teammateUUID),
    progress: (prior) => {
      const counts = { ...(prior.byTeammate || {}) };
      counts[payload.teammateUUID] = finite(counts[payload.teammateUUID]) + 1;
      return {
        ...prior,
        byTeammate: counts,
        bestPairCount: Math.max(0, ...Object.values(counts)),
      };
    },
    valueKey: 'bestPairCount',
    snapshot: evidence(event, { teammateUUID: payload.teammateUUID }),
  }, {
    id: 'balanced_pair',
    eligible: finite(payload.teamContributionRatio) >= 0.35
      && finite(payload.teamContributionRatio) <= 0.65
      && finite(payload.teamScore) > 0,
    snapshot: evidence(event, { contributionRatio: finite(payload.teamContributionRatio) }),
  }, {
    id: 'rally',
    eligible: won && deficit >= Math.max(3, finite(payload.comebackThreshold, 3)),
    snapshot: evidence(event, { teamRecovery: deficit }),
  }, {
    id: 'rivalry',
    eligible: Boolean(payload.mutualRivalryOptIn && finite(payload.rivalrySeriesCount) >= 3),
    snapshot: evidence(event, {
      opponentProfileId: payload.rivalProfileId || null,
      rivalrySeriesCount: finite(payload.rivalrySeriesCount),
      mutualOptIn: true,
    }),
  }, {
    id: 'climber',
    eligible: payload.previousHighestElo != null
      && finite(payload.newElo) > finite(payload.previousHighestElo),
    progress: (prior) => updateMaximum(prior, 'highestElo', payload.newElo),
    valueKey: 'highestElo',
    snapshot: evidence(event, {
      newElo: finite(payload.newElo),
      previousHighestElo: finite(payload.previousHighestElo),
    }),
  }, {
    id: 'summit',
    eligible: finite(payload.ladderPosition, Infinity) > 0
      && finite(payload.ladderPosition, Infinity) <= Math.max(1, finite(payload.topNeighborhoodSize, 10)),
    snapshot: evidence(event, {
      ladderPosition: finite(payload.ladderPosition),
      topNeighborhoodSize: Math.max(1, finite(payload.topNeighborhoodSize, 10)),
    }),
  }];
}

function chronicleCandidates(event) {
  const payload = event.payload || {};
  if (event.type === 'journal-saved') {
    const wordCount = finite(payload.wordCount);
    return [{
      id: 'first_record',
      eligible: payload.isNew !== false && wordCount >= 20,
      snapshot: evidence(event, { wordCount, entryKind: payload.entryKind || 'entry' }),
    }, {
      id: 'essayist',
      eligible: payload.entryKind === 'essay' && Boolean(payload.hasStructure || payload.headingCount >= 2),
      snapshot: evidence(event, { wordCount, headingCount: finite(payload.headingCount) }),
    }, {
      id: 'context_keeper',
      eligible: Boolean(payload.verifiedDaybookContext && payload.contextSnapshotUUID),
      snapshot: evidence(event, {
        contextSnapshotUUID: payload.contextSnapshotUUID,
        entryUUID: event.sourceUUID,
      }),
    }];
  }
  if (event.type === 'retrospective-action') {
    const action = payload.action;
    return [{
      id: 'looking_back',
      eligible: ['write_back', 'later_reflection', 'what_happened_afterward'].includes(action),
      snapshot: evidence(event, { action, targetUUID: payload.targetUUID || null }),
    }, {
      id: 'carry_forward',
      eligible: action === 'carry_forward' && Boolean(payload.usedInPresentAction),
      snapshot: evidence(event, { action, presentActionUUID: payload.presentActionUUID || null }),
    }];
  }
  if (event.type === 'story-updated') {
    return [{
      id: 'story_arc',
      eligible: finite(payload.distinctOccurrenceDates) >= 3,
      progress: (prior) => updateMaximum(prior, 'distinctOccurrenceDates', payload.distinctOccurrenceDates),
      valueKey: 'distinctOccurrenceDates',
      snapshot: evidence(event, { distinctOccurrenceDates: finite(payload.distinctOccurrenceDates) }),
    }, {
      id: 'old_story_closed',
      eligible: Boolean(payload.wasOldAndUnfinished && payload.meaningfulEnding),
      snapshot: evidence(event, { wasOldAndUnfinished: true }),
    }, {
      id: 'living_archive',
      eligible: Boolean(
        finite(payload.linkedStoryCount) >= 3
        && finite(payload.linkedMilestoneCount) >= 2
        && finite(payload.laterReflectionCount) >= 1,
      ),
      snapshot: evidence(event, {
        linkedStoryCount: finite(payload.linkedStoryCount),
        linkedMilestoneCount: finite(payload.linkedMilestoneCount),
        laterReflectionCount: finite(payload.laterReflectionCount),
      }),
    }];
  }
  return [];
}

function semanticCandidates(event) {
  const payload = event.payload || {};
  switch (event.type) {
    case 'event-logged':
      return [{
        id: 'rhythm',
        eligible: Boolean(
          payload.reliableReviewPeriod
          && finite(payload.intendedOpportunities) > 0
          && finite(payload.opportunityReliability) >= finite(payload.reliabilityThreshold, 0.7),
        ),
        progress: (prior) => increment(prior, 'reliableReviewPeriods'),
        valueKey: 'reliableReviewPeriods',
        snapshot: evidence(event, {
          intendedOpportunities: finite(payload.intendedOpportunities),
          completedOpportunities: finite(payload.completedOpportunities),
          opportunityReliability: finite(payload.opportunityReliability),
        }),
      }];
    case 'milestone-completed':
      return [{
        id: 'milestone_maker',
        eligible: Boolean(payload.evidenceUUID || payload.evidenceSummary),
        progress: (prior) => increment(prior, 'completedMilestones'),
        valueKey: 'completedMilestones',
        snapshot: evidence(event, { goalUUID: payload.goalUUID, milestoneUUID: event.sourceUUID }),
      }];
    case 'goal-completed':
      return [{
        id: 'goal_finisher',
        eligible: Boolean(payload.finishCondition && (payload.evidenceUUID || payload.evidenceSummary)),
        progress: (prior) => increment(prior, 'completedFiniteGoals'),
        valueKey: 'completedFiniteGoals',
        snapshot: evidence(event, { goalUUID: event.sourceUUID, finishCondition: payload.finishCondition }),
      }, {
        id: 'landmark',
        eligible: Boolean(payload.worldLandmarkUUID),
        snapshot: evidence(event, { worldLandmarkUUID: payload.worldLandmarkUUID }),
      }];
    case 'goal-reviewed':
      return [{
        id: 'wayfinder',
        eligible: Boolean(payload.finishCondition && payload.milestoneUUID && payload.nextActionUUID),
        snapshot: evidence(event, {
          goalUUID: event.sourceUUID,
          milestoneUUID: payload.milestoneUUID,
          nextActionUUID: payload.nextActionUUID,
        }),
      }, {
        id: 'course_correction',
        eligible: Boolean(payload.substantiveRevision && payload.restoredDirection),
        progress: (prior) => increment(prior, 'usefulGoalRevisions'),
        valueKey: 'usefulGoalRevisions',
        snapshot: evidence(event, { substantiveRevision: true, restoredDirection: true }),
      }];
    case 'semantic-response':
      return [{
        id: 'witness',
        eligible: Boolean(payload.targetProfileId && payload.meaningful !== false),
        snapshot: evidence(event, {
          targetProfileId: payload.targetProfileId,
          semanticKind: payload.semanticKind || null,
        }),
      }, {
        id: 'fellowship',
        eligible: Boolean(payload.targetProfileId && payload.sharedWork),
        progress: (prior) => addUnique(prior, 'fellowIds', payload.targetProfileId),
        valueKey: 'fellowIds.length',
        snapshot: evidence(event, { targetProfileId: payload.targetProfileId }),
      }];
    case 'theme-applied':
      return [{
        id: 'unusual_theme',
        eligible: Boolean(payload.isUnusual),
        snapshot: evidence(event, { themeId: payload.themeId }),
      }];
    case 'profile-updated':
      return [{
        id: 'climber',
        eligible: payload.previousHighestElo != null
          && finite(payload.elo) > finite(payload.previousHighestElo),
        progress: (prior) => updateMaximum(prior, 'highestElo', payload.elo),
        valueKey: 'highestElo',
        snapshot: evidence(event, {
          newElo: finite(payload.elo),
          previousHighestElo: finite(payload.previousHighestElo),
        }),
      }, {
        id: 'summit',
        eligible: finite(payload.highestLadderPosition, Infinity) > 0
          && finite(payload.highestLadderPosition, Infinity) <= Math.max(1, finite(payload.topNeighborhoodSize, 10)),
        snapshot: evidence(event, { ladderPosition: finite(payload.highestLadderPosition) }),
      }];
    case 'project-evidence-updated':
      return [{
        id: 'builder',
        eligible: Boolean(
          payload.projectUUID
          && finite(payload.completedTaskCount) >= 3
          && payload.milestoneUUID,
        ),
        snapshot: evidence(event, {
          projectUUID: payload.projectUUID,
          completedTaskCount: finite(payload.completedTaskCount),
          milestoneUUID: payload.milestoneUUID,
        }),
      }];
    case 'era-transitioned':
      return [{
        id: 'era_keeper',
        eligible: Boolean(
          payload.historyPreserved
          && payload.chronicleContextUUID
          && payload.transitionSummary,
        ),
        snapshot: evidence(event, {
          eraUUID: event.sourceUUID,
          chronicleContextUUID: payload.chronicleContextUUID,
          transitionSummary: payload.transitionSummary,
        }),
      }];
    case 'shared-history-updated':
      return [{
        id: 'shared_history',
        eligible: Boolean(
          payload.otherProfileId
          && finite(payload.collaborationCount) >= 3
          && payload.durableTraceUUID,
        ),
        snapshot: evidence(event, {
          otherProfileId: payload.otherProfileId,
          collaborationCount: finite(payload.collaborationCount),
          durableTraceUUID: payload.durableTraceUUID,
        }),
      }];
    default:
      return [];
  }
}

function valueAt(progress, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], progress);
}

async function applyCandidate(repository, profileId, event, candidate) {
  const definition = ACHIEVEMENT_V2_BY_ID.get(candidate.id);
  if (!definition || !candidate.eligible) return null;
  let progress = await repository.getProgress(profileId, definition.id, definition.version);
  const appliedEventIds = Array.isArray(progress?.appliedEventIds) ? progress.appliedEventIds : [];
  const alreadyApplied = appliedEventIds.includes(event.UUID);
  if (candidate.progress) {
    if (!alreadyApplied) progress = candidate.progress(progress || {});
    progress = {
      ...progress,
      appliedEventIds: alreadyApplied ? appliedEventIds : [...appliedEventIds, event.UUID],
    };
    await repository.saveProgress(profileId, definition, progress, event.occurredAt || event.createdAt);
  }
  const currentValue = candidate.valueKey ? finite(valueAt(progress, candidate.valueKey)) : 1;
  const resolvedValue = candidate.value ?? currentValue;
  const earnedAt = event.occurredAt || event.createdAt || new Date().toISOString();
  for (const [index, threshold] of (definition.stages || [1]).entries()) {
    if (resolvedValue < finite(threshold, 1)) continue;
    // Stage receipts are immutable and let badge frames evolve independently
    // from the first evidence award.
    // eslint-disable-next-line no-await-in-loop
    await repository.awardStage?.({
      profileId,
      definition,
      stage: index + 1,
      thresholdValue: threshold,
      sourceEventIds: [event.UUID],
      evidenceSnapshot: { ...candidate.snapshot, value: resolvedValue },
      earnedAt,
    });
  }
  if (!meetsFirstStage(definition, resolvedValue)) return null;
  const result = await repository.award({
    profileId,
    definition,
    sourceEventIds: [event.UUID],
    evidenceSnapshot: candidate.snapshot,
    earnedAt,
    processorVersion: ACHIEVEMENT_V2_PROCESSOR_VERSION,
  });
  return result.awarded ? definition.id : null;
}

async function updateCrossDomainEvidence(repository, profileId, event) {
  const definition = ACHIEVEMENT_V2_BY_ID.get('evidence_trail');
  const domain = EVENT_DOMAIN[event.type];
  if (!definition || !domain) return null;
  let progress = await repository.getProgress(profileId, definition.id, definition.version);
  const appliedEventIds = Array.isArray(progress?.appliedEventIds) ? progress.appliedEventIds : [];
  progress = {
    ...addUnique(progress || {}, 'domains', domain),
    appliedEventIds: appliedEventIds.includes(event.UUID)
      ? appliedEventIds
      : [...appliedEventIds, event.UUID],
  };
  await repository.saveProgress(profileId, definition, progress, event.occurredAt || event.createdAt);
  for (const [index, threshold] of (definition.stages || [1]).entries()) {
    if (progress.domains.length < finite(threshold, 1)) continue;
    // eslint-disable-next-line no-await-in-loop
    await repository.awardStage?.({
      profileId,
      definition,
      stage: index + 1,
      thresholdValue: threshold,
      sourceEventIds: [event.UUID],
      evidenceSnapshot: evidence(event, { domains: progress.domains }),
      earnedAt: event.occurredAt || event.createdAt || new Date().toISOString(),
    });
  }
  if (!meetsFirstStage(definition, progress.domains.length)) return null;
  const result = await repository.award({
    profileId,
    definition,
    sourceEventIds: [event.UUID],
    evidenceSnapshot: evidence(event, { domains: progress.domains }),
    earnedAt: event.occurredAt || event.createdAt || new Date().toISOString(),
    processorVersion: ACHIEVEMENT_V2_PROCESSOR_VERSION,
  });
  return result.awarded ? definition.id : null;
}

async function updateRecords(repository, profileId, event) {
  const payload = event.payload || {};
  if (event.type === 'task-completed') {
    const minutes = Math.max(0, finite(payload.durationMs) / 60000);
    if (payload.durationVerified === true && minutes > 0) await repository.upsertRecord({
      profileId,
      recordId: 'longest_focus_session',
      value: { value: minutes, taskUUID: payload.taskUUID || event.sourceUUID },
      achievedAt: event.occurredAt,
      sourceEventId: event.UUID,
    });
  }
  if (event.type === 'match-completed') {
    if (finite(payload.newElo) > 0) await repository.upsertRecord({
      profileId,
      recordId: 'best_rating',
      value: { value: finite(payload.newElo), matchUUID: event.sourceUUID },
      achievedAt: event.occurredAt,
      sourceEventId: event.UUID,
    });
    if (finite(payload.maxDeficitRecovered) > 0) await repository.upsertRecord({
      profileId,
      recordId: 'best_match_comeback',
      value: { value: finite(payload.maxDeficitRecovered), matchUUID: event.sourceUUID },
      achievedAt: event.occurredAt,
      sourceEventId: event.UUID,
    });
  }
  if (event.type === 'profile-updated' && finite(payload.highestLadderPosition) > 0) {
    // Ladder position is lower-is-better and is written only from an explicit rank event.
    const existing = await repository.getRecord(profileId, 'highest_ladder_position');
    const next = finite(payload.highestLadderPosition);
    const prior = finite(existing?.value?.value, Infinity);
    if (next < prior) await repository.setRecord({
      profileId,
      recordId: 'highest_ladder_position',
      value: { value: next },
      achievedAt: event.occurredAt,
      sourceEventId: event.UUID,
    });
  }
}

export async function processAchievementV2Event(databaseConnection, event) {
  if (!databaseConnection || !event?.UUID || !event?.parent || !EVENT_DOMAIN[event.type]) {
    return { earned: [], status: 'ignored' };
  }
  const repository = databaseConnection.achievementV2
    || new AchievementV2Repository(databaseConnection);
  const candidates = [
    ...taskCandidates(event),
    ...matchCandidates(event),
    ...chronicleCandidates(event),
    ...semanticCandidates(event),
  ];
  const earned = [];
  const crossDomain = await updateCrossDomainEvidence(repository, event.parent, event);
  if (crossDomain) earned.push(crossDomain);
  for (const candidate of candidates) {
    // Event-local progress writes are intentionally sequential and idempotent by receipt.
    // eslint-disable-next-line no-await-in-loop
    const achievementId = await applyCandidate(repository, event.parent, event, candidate);
    if (achievementId) earned.push(achievementId);
  }
  await updateRecords(repository, event.parent, event);
  return { earned, status: 'completed', evaluated: candidates.length };
}

export async function replayAchievementV2Evidence(databaseConnection, profileId, events = null) {
  const source = events || await databaseConnection.getAll(STORES.achievementEvent);
  const ordered = source
    .filter((event) => event?.parent === profileId)
    .sort((left, right) => String(left.occurredAt || '').localeCompare(String(right.occurredAt || '')));
  const earned = [];
  for (const event of ordered) {
    // Explicit repair replays immutable evidence in chronological order.
    // eslint-disable-next-line no-await-in-loop
    const result = await processAchievementV2Event(databaseConnection, event);
    earned.push(...result.earned);
  }
  return { replayed: ordered.length, earned: [...new Set(earned)] };
}

export function achievementV2Coverage() {
  return {
    definitions: ACHIEVEMENT_DEFINITIONS_V2.length,
    eventTypes: Object.keys(EVENT_DOMAIN),
  };
}

export default processAchievementV2Event;
