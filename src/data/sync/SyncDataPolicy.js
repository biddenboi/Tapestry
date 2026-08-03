/**
 * Phase-0 synchronization boundary.
 *
 * `shared` records may be represented by domain commands in the live sync log.
 * `local` records are device preferences or private working state.
 * `derived` records are rebuilt from shared evidence and never uploaded.
 * `attachment` records synchronize metadata only; bytes stay outside row sync.
 */
export const SYNC_DATA_CLASS = Object.freeze({
  shared: 'shared',
  local: 'local',
  derived: 'derived',
  attachment: 'attachment-metadata-only',
});

const shared = [
  'players', 'profileSummaries', 'projects', 'todos', 'tasks', 'taskCompletionEvents',
  'taskCompletionReceipts', 'reminders', 'goalAreas', 'goalMilestones', 'goalUpdates',
  'goalLinks', 'goalParticipants', 'actionPlans', 'actionSessions', 'handoffs',
  'matches', 'matchScoreEvents', 'rewardProvenance', 'shop', 'inventory', 'transactions',
  'events', 'eventLogs', 'eventBuffs', 'contributions', 'rhythmDefinitions',
  'rhythmOpportunities', 'customEvents', 'interventionDecisions',
  'worldConsequenceReceipts', 'chronicleEntryMetadata', 'chronicleStories',
  'chronicleStoryEntries', 'chronicleEntryLinks', 'chronicleEntryRevisions',
  'chronicleEntryOperationReceipts', 'chronicleEntryConflicts', 'journals',
  'journalComments', 'chronicleReactions', 'chronicleEntryAccess',
  'chronicleLegacyNoteMappings', 'achievementEvents', 'achievementReceipts',
  'friendships', 'notifications', 'contributionRoadChoices', 'contributionRoadUnlocks',
];

const local = [
  'appSettings', 'nextMoveSurfacePreferences', 'chronicleDrafts',
  'chronicleFeedViewStates', 'chronicleStoryReadStates', 'chronicleResurfaceStates',
  'notes', 'analyticsEvents', 'profileContextPreferences',
  'profileContextItems', 'profileContextRecipients', 'profileContextAudit',
  'nextMoveDecisions', 'nextMoveFeedback', 'taskPlanReceipts', 'interfaceRevealReceipts',
];

const derived = [
  'derivedCaches', 'taskRecommendations', 'achievementStates', 'profileContextSuggestions',
  'backgroundJobs', 'backgroundJobReceipts', 'contributionRoadStats',
  'contributionRoadMigrations', 'chronicleCollaborationOutbox',
];

const attachment = ['resources'];

const classification = new Map([
  ...shared.map((store) => [store, SYNC_DATA_CLASS.shared]),
  ...local.map((store) => [store, SYNC_DATA_CLASS.local]),
  ...derived.map((store) => [store, SYNC_DATA_CLASS.derived]),
  ...attachment.map((store) => [store, SYNC_DATA_CLASS.attachment]),
]);

export const SYNC_STORE_CLASSIFICATION = Object.freeze(Object.fromEntries(classification));

export function classifySyncStore(store) {
  return classification.get(String(store || '')) || null;
}

export function assertSharedSyncStore(store) {
  const kind = classifySyncStore(store);
  if (kind !== SYNC_DATA_CLASS.shared && kind !== SYNC_DATA_CLASS.attachment) {
    const error = new Error(`${store || 'This store'} is not eligible for live synchronization.`);
    error.code = 'sync-store-not-shared';
    throw error;
  }
  return kind;
}

export const SYNC_FIELD_POLICY = Object.freeze({
  players: Object.freeze({
    shared: Object.freeze([
      'UUID', 'username', 'profilePicture', 'elo', 'tokens', 'wakeTime', 'sleepTime',
      'wakeChecklist', 'sleepChecklist', 'profileVisibility', 'createdAt', 'updatedAt',
    ]),
    local: Object.freeze(['activePanel', 'activeSubview', 'selectedProfile']),
    derived: Object.freeze(['rank', 'completedTaskCount', 'recommendationSnapshot']),
    attachment: Object.freeze(['profilePicture']),
  }),
  todos: Object.freeze({
    shared: Object.freeze([
      'UUID', 'parent', 'projectId', 'name', 'description', 'planNotes', 'dueDate',
      'workspaceId', 'createdByPlayerId', 'estimatedDuration', 'recurrence', 'reminders',
      'createdAt', 'updatedAt', 'deletedAt',
    ]),
    local: Object.freeze(['presencePaused']),
    derived: Object.freeze([
      'dueDateObj', 'dueKey', 'dueState', 'isOverdue', 'isToday', 'slope', 'slopeTier',
      'projectName', 'projectColor', 'wpd', 'ageDays', 'weight', 'recommendation',
    ]),
    attachment: Object.freeze([]),
  }),
  tasks: Object.freeze({
    shared: Object.freeze([
      'UUID', 'parent', 'todoUUID', 'projectId', 'name', 'description', 'completedAt',
      'workspaceId', 'sessionDuration', 'points', 'pointsBase', 'completionEventUUID', 'actionSessionUUID',
      'createdAt', 'updatedAt', 'deletedAt',
    ]),
    local: Object.freeze([]),
    derived: Object.freeze(['projectName', 'projectColor', 'recommendation']),
    attachment: Object.freeze([]),
  }),
  actionSessions: Object.freeze({
    shared: Object.freeze([
      'UUID', 'parent', 'targetType', 'targetUUID', 'goalUUID', 'milestoneUUID',
      'matchUUID', 'dojoSessionUUID', 'startedAt', 'endedAt', 'activeDurationMs',
      'pausedDurationMs', 'activeAnchorAt', 'pausedAt', 'outcome', 'blockerType',
      'nextStep', 'outcomeNote', 'matchRewardContract', 'matchScoreFinalizedAt',
      'matchScoreEventUUID', 'createdAt', 'updatedAt', 'controllingDeviceId',
    ]),
    local: Object.freeze([]),
    derived: Object.freeze(['elapsedDisplayMs']),
    attachment: Object.freeze([]),
  }),
  journals: Object.freeze({
    shared: Object.freeze([
      'UUID', 'parent', 'title', 'entry', 'kind', 'visibility', 'createdAt', 'updatedAt',
      'deletedAt', 'revision',
    ]),
    local: Object.freeze(['composerSelection']),
    derived: Object.freeze(['searchTokens', 'feedRank']),
    attachment: Object.freeze(['attachments', 'images']),
  }),
  inventory: Object.freeze({
    shared: Object.freeze([
      'UUID', 'parent', 'itemUUID', 'itemId', 'type', 'quantity', 'cooldownUntil',
      'lastUsedAt', 'useCount', 'purchasedAt', 'purchaseCount',
    ]),
    local: Object.freeze([]),
    derived: Object.freeze(['remainingDurationMs']),
    attachment: Object.freeze(['bannerImageUrl']),
  }),
});

export function stripDerivedSyncFields(store, record = {}) {
  const policy = SYNC_FIELD_POLICY[store];
  if (!policy) return structuredClone(record);
  const excluded = new Set([...policy.local, ...policy.derived]);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !excluded.has(key)),
  );
}

export default SYNC_STORE_CLASSIFICATION;
