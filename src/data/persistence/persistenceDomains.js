import { STORES } from '@domain/constants.js';

export const PERSISTENCE_DOMAIN = Object.freeze({
  core: 'core',
  tasks: 'tasks',
  recommender: 'recommender',
  analytics: 'analytics',
  achievements: 'achievements',
  journals: 'journals',
  events: 'events',
  eventTrackers: 'eventTrackers',
  eventBuffs: 'eventBuffs',
  goals: 'goals',
  dailyLifecycle: 'dailyLifecycle',
  eventAnalytics: 'eventAnalytics',
  competitiveArenas: 'competitiveArenas',
  shop: 'shop',
  inventory: 'inventory',
  matches: 'matches',
  leaderboards: 'leaderboards',
  social: 'social',
  presence: 'presence',
  socialWorld: 'socialWorld',
  notes: 'notes',
  reminders: 'reminders',
  continuity: 'continuity',
  rhythms: 'rhythms',
  interventions: 'interventions',
  worldConsequences: 'worldConsequences',
  profiles: 'profiles',
  profileSummaries: 'profileSummaries',
  resources: 'resources',
  nextMove: 'nextMove',
  chronicle: 'chronicle',
  contributionRoad: 'contributionRoad',
});

export const PERSISTENCE_ARTIFACT_CLASS = Object.freeze({
  authoritative: 'authoritative-data',
  derivedCache: 'derived-cache',
  modelArtifact: 'model-artifact',
  userSnapshot: 'user-snapshot',
  recoveryGeneration: 'recovery-generation',
});

const STORE_DOMAINS = Object.freeze({
  [STORES.task]: ['tasks'],
  [STORES.taskCompletionEvent]: ['tasks'],
  [STORES.taskCompletionReceipt]: ['tasks'],
  [STORES.actionPlan]: ['continuity'],
  [STORES.actionSession]: ['tasks', 'continuity'],
  [STORES.handoff]: ['continuity'],
  [STORES.rhythmDefinition]: ['rhythms', 'eventTrackers'],
  [STORES.rhythmOpportunity]: ['rhythms', 'eventTrackers'],
  [STORES.interventionDecision]: ['interventions', 'reminders'],
  [STORES.rewardProvenance]: ['continuity'],
  [STORES.worldConsequenceReceipt]: ['worldConsequences', 'continuity'],
  [STORES.matchScoreEvent]: ['matches', 'continuity'],
  [STORES.taskPlanReceipt]: ['tasks', 'nextMove'],
  [STORES.nextMoveDecision]: ['nextMove'],
  [STORES.nextMoveFeedback]: ['nextMove'],
  [STORES.nextMoveSurfacePreference]: ['nextMove'],
  [STORES.chronicleEntryMetadata]: ['chronicle'],
  [STORES.chronicleStory]: ['chronicle'],
  [STORES.chronicleStoryEntry]: ['chronicle'],
  [STORES.chronicleEntryLink]: ['chronicle'],
  [STORES.chronicleDraft]: ['chronicle'],
  [STORES.chronicleReaction]: ['chronicle'],
  [STORES.chronicleFeedViewState]: ['chronicle'],
  [STORES.chronicleStoryReadState]: ['chronicle'],
  [STORES.chronicleResurfaceState]: ['chronicle'],
  [STORES.chronicleEntryAccess]: ['chronicle'],
  [STORES.chronicleEntryRevision]: ['chronicle'],
  [STORES.chronicleEntryOperationReceipt]: ['chronicle'],
  [STORES.chronicleEntryConflict]: ['chronicle'],
  [STORES.chronicleCollaborationOutbox]: ['chronicle'],
  [STORES.chronicleLegacyNoteMapping]: ['chronicle'],
  [STORES.achievementEvent]: ['achievements'],
  [STORES.achievementState]: ['achievements'],
  [STORES.achievementReceipt]: ['achievements'],
  [STORES.todo]: ['tasks'],
  [STORES.project]: ['tasks', 'goals'],
  [STORES.contribution]: ['tasks', 'goals', 'competitiveArenas'],
  [STORES.recommenderEvent]: ['recommender'],
  [STORES.analyticsEvent]: ['analytics'],
  [STORES.journal]: ['journals'],
  [STORES.journalComment]: ['journals'],
  [STORES.event]: ['dailyLifecycle'],
  [STORES.customEvent]: ['eventTrackers'],
  [STORES.eventLog]: ['eventTrackers', 'eventAnalytics'],
  [STORES.eventBuff]: ['eventBuffs', 'matches'],
  [STORES.shop]: ['shop'],
  [STORES.transaction]: ['shop'],
  [STORES.inventory]: ['inventory'],
  [STORES.match]: ['matches'],
  [STORES.backgroundJob]: ['matches'],
  [STORES.backgroundJobReceipt]: ['matches'],
  [STORES.friendship]: ['social'],
  [STORES.notification]: ['social'],
  [STORES.notes]: ['notes'],
  [STORES.reminder]: ['reminders'],
  [STORES.player]: ['profiles'],
  [STORES.profileSummary]: ['profileSummaries'],
  [STORES.derivedCache]: ['leaderboards', 'profileSummaries'],
  [STORES.resource]: ['resources'],
  [STORES.contributionRoadStat]: ['contributionRoad'],
  [STORES.contributionRoadChoice]: ['contributionRoad', 'inventory'],
  [STORES.contributionRoadUnlock]: ['contributionRoad', 'inventory'],
  [STORES.contributionRoadMigration]: ['contributionRoad'],
  [STORES.interfaceRevealReceipt]: ['contributionRoad'],
});

const MODEL_SETTING_PREFIXES = Object.freeze([
  'task-recommender',
]);
const EVENT_SETTING_PREFIXES = Object.freeze([
  'wake-boundary:',
  'day-boundary:',
  'end-of-day:',
]);
const LEADERBOARD_SETTING_PREFIXES = Object.freeze([
  'dojoLeaderboardSnapshot:',
  'matchLeaderboardSnapshot:',
  'contributionLeaderboardSnapshot:',
]);

export function isDerivedCacheSetting(record = null) {
  const id = String(record?.UUID || '');
  return LEADERBOARD_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function classifyDerivedCache(record = null) {
  const id = String(record?.UUID || '');
  if (LEADERBOARD_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return { domains: [PERSISTENCE_DOMAIN.leaderboards] };
  }
  return { domains: [PERSISTENCE_DOMAIN.core] };
}

export function isRecommenderModelSetting(record = null) {
  const id = String(record?.UUID || '');
  return MODEL_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function classifyAppSetting(record = null) {
  const id = String(record?.UUID || '');
  if (isRecommenderModelSetting(record)) {
    return {
      domains: [PERSISTENCE_DOMAIN.recommender],
      artifactClass: PERSISTENCE_ARTIFACT_CLASS.modelArtifact,
    };
  }
  if (EVENT_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return {
      domains: [PERSISTENCE_DOMAIN.dailyLifecycle],
      artifactClass: PERSISTENCE_ARTIFACT_CLASS.authoritative,
    };
  }
  if (RETIRED_GEOGRAPHIC_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return {
      domains: [PERSISTENCE_DOMAIN.core],
      artifactClass: PERSISTENCE_ARTIFACT_CLASS.derivedCache,
    };
  }
  if (LEADERBOARD_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return {
      domains: [PERSISTENCE_DOMAIN.leaderboards],
      artifactClass: PERSISTENCE_ARTIFACT_CLASS.derivedCache,
    };
  }
  return {
    domains: [PERSISTENCE_DOMAIN.core],
    artifactClass: PERSISTENCE_ARTIFACT_CLASS.authoritative,
  };
}

function stableField(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
}

export function storeMutationTouchesResourceSidecars(
  store,
  record = null,
  previousRecord = null,
  mutationType = 'put',
) {
  if (store === STORES.resource || store === STORES.journal) return true;
  const sidecarFields = {
    [STORES.player]: ['profilePicture', 'activeCosmetics'],
    [STORES.customEvent]: ['bannerImageUrl'],
    [STORES.shop]: ['bannerImageUrl'],
  }[store];
  if (!sidecarFields) return false;
  if (mutationType === 'clear' || mutationType === 'replace-store') return true;
  return sidecarFields.some((field) => (
    stableField(record?.[field]) !== stableField(previousRecord?.[field])
  ));
}

export function persistenceMetadataForStore(store, record = null) {
  if (store === STORES.derivedCache) {
    const classified = classifyDerivedCache(record);
    return {
      store,
      domains: classified.domains,
      artifactClass: PERSISTENCE_ARTIFACT_CLASS.derivedCache,
    };
  }
  if (store === STORES.appSetting) {
    const classified = classifyAppSetting(record);
    return { store, ...classified };
  }
  const domains = STORE_DOMAINS[store] || [PERSISTENCE_DOMAIN.core];
  const artifactClass = [
    STORES.analyticsEvent,
    STORES.taskCompletionReceipt,
    STORES.achievementState,
    STORES.achievementReceipt,
    STORES.backgroundJobReceipt,
    STORES.profileSummary,
    STORES.nextMoveDecision,
    STORES.contributionRoadStat,
  ].includes(store)
    ? PERSISTENCE_ARTIFACT_CLASS.derivedCache
    : PERSISTENCE_ARTIFACT_CLASS.authoritative;
  return { store, domains: [...domains], artifactClass };
}

export function allPersistenceDomains() {
  return Object.values(PERSISTENCE_DOMAIN);
}
