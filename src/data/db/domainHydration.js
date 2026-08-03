export const HYDRATION_DOMAIN = Object.freeze({
  tasks: 'tasks',
  dojoSource: 'dojoSource',
  recommender: 'recommender',
  matches: 'matches',
  leaderboards: 'leaderboards',
  social: 'social',
  presence: 'presence',
  socialWorld: 'socialWorld',
  feed: 'feed',
  journals: 'journals',
  shop: 'shop',
  inventory: 'inventory',
  events: 'events', // aggregate event domain
  eventTrackers: 'eventTrackers',
  eventBuffs: 'eventBuffs',
  goals: 'goals',
  dailyLifecycle: 'dailyLifecycle',
  eventAnalytics: 'eventAnalytics',
  competitiveArenas: 'competitiveArenas',
  achievements: 'achievements',
  reminders: 'reminders',
  profiles: 'profiles',
  profileSummaries: 'profileSummaries',
  profileContext: 'profileContext',
  profileTimeline: 'profileTimeline',
  profileMatches: 'profileMatches',
  profileSocial: 'profileSocial',
  profileInventory: 'profileInventory',
  notes: 'notes',
  analytics: 'analytics',
  nextMove: 'nextMove',
  chronicle: 'chronicle',
  contributionRoad: 'contributionRoad',
});

export const HYDRATION_DOMAINS = Object.freeze(Object.values(HYDRATION_DOMAIN));

export const DOMAIN_STORE_KEYS = Object.freeze({
  [HYDRATION_DOMAIN.tasks]: Object.freeze([
    'tasks', 'todos', 'projects', 'reminders', 'contributions',
    'taskCompletionEvents', 'taskCompletionReceipts', 'actionPlans',
    'actionSessions', 'handoffs', 'rewardProvenance',
    'worldConsequenceReceipts', 'matchScoreEvents',
    'taskPlanReceipts',
  ]),
  [HYDRATION_DOMAIN.nextMove]: Object.freeze([
    'taskPlanReceipts',
    'nextMoveDecisions',
    'nextMoveFeedback',
    'nextMoveSurfacePreferences',
  ]),
  [HYDRATION_DOMAIN.dojoSource]: Object.freeze(['tasks', 'todos']),
  [HYDRATION_DOMAIN.recommender]: Object.freeze(['taskRecommendations', 'appSettings']),
  [HYDRATION_DOMAIN.matches]: Object.freeze([
    'matches', 'backgroundJobs', 'backgroundJobReceipts', 'matchScoreEvents',
    'rewardProvenance', 'worldConsequenceReceipts',
  ]),
  [HYDRATION_DOMAIN.social]: Object.freeze(['friendships', 'notifications']),
  [HYDRATION_DOMAIN.presence]: Object.freeze([]),
  [HYDRATION_DOMAIN.socialWorld]: Object.freeze([]),
  [HYDRATION_DOMAIN.feed]: Object.freeze([
    'journalComments',
    'chronicleEntryMetadata',
    'chronicleStories',
    'chronicleStoryEntries',
    'chronicleReactions',
    'chronicleFeedViewStates',
    'chronicleEntryAccess',
    'chronicleEntryRevisions',
  ]),
  [HYDRATION_DOMAIN.journals]: Object.freeze([]),
  [HYDRATION_DOMAIN.chronicle]: Object.freeze([
    'chronicleEntryMetadata',
    'chronicleStories',
    'chronicleStoryEntries',
    'chronicleEntryLinks',
    'chronicleDrafts',
    'chronicleReactions',
    'chronicleFeedViewStates',
    'chronicleStoryReadStates',
    'chronicleResurfaceStates',
    'chronicleEntryAccess',
    'chronicleEntryRevisions',
    'chronicleEntryOperationReceipts',
    'chronicleEntryConflicts',
    'chronicleCollaborationOutbox',
    'chronicleLegacyNoteMappings',
  ]),
  [HYDRATION_DOMAIN.shop]: Object.freeze(['shop', 'transactions']),
  [HYDRATION_DOMAIN.inventory]: Object.freeze(['inventory']),
  [HYDRATION_DOMAIN.eventTrackers]: Object.freeze([
    'customEvents', 'eventLogs', 'rhythmDefinitions', 'rhythmOpportunities',
  ]),
  [HYDRATION_DOMAIN.eventBuffs]: Object.freeze(['eventBuffs']),
  [HYDRATION_DOMAIN.goals]: Object.freeze([
    'projects',
    'goalAreas',
    'goalMilestones',
    'goalUpdates',
    'goalLinks',
    'goalParticipants',
    'appSettings',
  ]),
  [HYDRATION_DOMAIN.dailyLifecycle]: Object.freeze([
    'events', 'appSettings', 'actionPlans', 'actionSessions', 'handoffs',
    'interventionDecisions',
  ]),
  [HYDRATION_DOMAIN.eventAnalytics]: Object.freeze(['eventLogs']),
  [HYDRATION_DOMAIN.competitiveArenas]: Object.freeze(['contributions']),
  [HYDRATION_DOMAIN.events]: Object.freeze([
    'events', 'customEvents', 'eventLogs', 'projects', 'goalAreas', 'goalMilestones',
    'goalUpdates', 'goalLinks', 'goalParticipants', 'contributions', 'appSettings',
  ]),
  [HYDRATION_DOMAIN.reminders]: Object.freeze(['reminders', 'interventionDecisions']),
  [HYDRATION_DOMAIN.profiles]: Object.freeze(['players']),
  [HYDRATION_DOMAIN.profileSummaries]: Object.freeze(['profileSummaries']),
  [HYDRATION_DOMAIN.profileContext]: Object.freeze([
    'profileContextItems',
    'profileContextRecipients',
    'profileContextSuggestions',
    'profileContextPreferences',
    'profileContextAudit',
  ]),
  [HYDRATION_DOMAIN.profileTimeline]: Object.freeze(['transactions']),
  [HYDRATION_DOMAIN.profileMatches]: Object.freeze([]),
  [HYDRATION_DOMAIN.profileSocial]: Object.freeze([]),
  [HYDRATION_DOMAIN.profileInventory]: Object.freeze([]),
  [HYDRATION_DOMAIN.notes]: Object.freeze(['notes']),
  [HYDRATION_DOMAIN.analytics]: Object.freeze(['analyticsEvents']),
  [HYDRATION_DOMAIN.leaderboards]: Object.freeze(['derivedCaches']),
  [HYDRATION_DOMAIN.achievements]: Object.freeze(['achievementEvents', 'achievementStates', 'achievementReceipts']),
  [HYDRATION_DOMAIN.contributionRoad]: Object.freeze([
    'contributionRoadStats',
    'contributionRoadChoices',
    'contributionRoadUnlocks',
    'contributionRoadMigrations',
    'interfaceRevealReceipts',
  ]),
});

export const DOMAIN_DEPENDENCIES = Object.freeze({
  [HYDRATION_DOMAIN.social]: Object.freeze([HYDRATION_DOMAIN.profiles]),
  [HYDRATION_DOMAIN.socialWorld]: Object.freeze([
    HYDRATION_DOMAIN.presence,
    HYDRATION_DOMAIN.profiles,
    HYDRATION_DOMAIN.tasks,
    HYDRATION_DOMAIN.matches,
    HYDRATION_DOMAIN.social,
    HYDRATION_DOMAIN.profileContext,
  ]),
  [HYDRATION_DOMAIN.profileContext]: Object.freeze([HYDRATION_DOMAIN.profiles]),
  [HYDRATION_DOMAIN.leaderboards]: Object.freeze([]),
  [HYDRATION_DOMAIN.achievements]: Object.freeze([HYDRATION_DOMAIN.profiles]),
  [HYDRATION_DOMAIN.nextMove]: Object.freeze([
    HYDRATION_DOMAIN.tasks,
    HYDRATION_DOMAIN.goals,
    HYDRATION_DOMAIN.reminders,
  ]),
  [HYDRATION_DOMAIN.contributionRoad]: Object.freeze([
    HYDRATION_DOMAIN.profiles,
    HYDRATION_DOMAIN.inventory,
    HYDRATION_DOMAIN.achievements,
  ]),
  [HYDRATION_DOMAIN.feed]: Object.freeze([
    HYDRATION_DOMAIN.journals,
    HYDRATION_DOMAIN.chronicle,
    HYDRATION_DOMAIN.profiles,
  ]),
  [HYDRATION_DOMAIN.chronicle]: Object.freeze([
    HYDRATION_DOMAIN.journals,
  ]),
  [HYDRATION_DOMAIN.competitiveArenas]: Object.freeze([HYDRATION_DOMAIN.goals]),
  [HYDRATION_DOMAIN.profileTimeline]: Object.freeze([
    HYDRATION_DOMAIN.profiles,
    HYDRATION_DOMAIN.tasks,
    HYDRATION_DOMAIN.journals,
    HYDRATION_DOMAIN.dailyLifecycle,
  ]),
  [HYDRATION_DOMAIN.profileMatches]: Object.freeze([HYDRATION_DOMAIN.matches]),
  [HYDRATION_DOMAIN.profileSocial]: Object.freeze([HYDRATION_DOMAIN.social]),
  [HYDRATION_DOMAIN.profileInventory]: Object.freeze([HYDRATION_DOMAIN.inventory, HYDRATION_DOMAIN.goals, HYDRATION_DOMAIN.competitiveArenas]),
});

export function normalizeHydrationDomains(domains) {
  const requested = Array.isArray(domains) ? domains : [domains];
  const normalized = [];
  const seen = new Set();
  for (const domain of requested.flat(Infinity)) {
    if (!HYDRATION_DOMAINS.includes(domain) || seen.has(domain)) continue;
    seen.add(domain);
    normalized.push(domain);
  }
  return normalized;
}
