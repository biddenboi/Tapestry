export const DATA_DOMAIN = Object.freeze({
  tasks: 'tasks',
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
  nextMove: 'nextMove',
  chronicle: 'chronicle',
  contributionRoad: 'contributionRoad',
});

export const DATA_DOMAINS = Object.freeze(Object.values(DATA_DOMAIN));
const DATA_DOMAIN_SET = new Set(DATA_DOMAINS);

function freezeDomains(domains) {
  return Object.freeze([...domains]);
}

export const DOMAIN_INVALIDATION = Object.freeze({
  taskWrite: freezeDomains([
    DATA_DOMAIN.tasks,
    DATA_DOMAIN.recommender,
    DATA_DOMAIN.leaderboards,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.socialWorld,
    DATA_DOMAIN.profileContext,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  recommenderWrite: freezeDomains([DATA_DOMAIN.recommender, DATA_DOMAIN.contributionRoad]),
  matchWrite: freezeDomains([
    DATA_DOMAIN.matches,
    DATA_DOMAIN.leaderboards,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.socialWorld,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  inboxWrite: freezeDomains([DATA_DOMAIN.social]),
  socialWrite: freezeDomains([
    DATA_DOMAIN.social,
    DATA_DOMAIN.socialWorld,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.contributionRoad,
  ]),
  journalWrite: freezeDomains([
    DATA_DOMAIN.journals,
    DATA_DOMAIN.chronicle,
    DATA_DOMAIN.feed,
    DATA_DOMAIN.social,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  shopCatalogWrite: freezeDomains([DATA_DOMAIN.shop]),
  shopPurchaseCommit: freezeDomains([
    DATA_DOMAIN.shop,
    DATA_DOMAIN.inventory,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
  ]),
  shopPurchaseSecondary: freezeDomains([
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
  ]),
  inventoryWrite: freezeDomains([
    DATA_DOMAIN.inventory,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
  ]),
  inventoryUse: freezeDomains([
    DATA_DOMAIN.inventory,
    DATA_DOMAIN.eventBuffs,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
  ]),
  walletWrite: freezeDomains([
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.shop,
  ]),
  presenceWrite: freezeDomains([
    DATA_DOMAIN.presence,
    DATA_DOMAIN.socialWorld,
  ]),
  eventDefinitionWrite: freezeDomains([
    DATA_DOMAIN.eventTrackers,
    DATA_DOMAIN.eventAnalytics,
  ]),
  eventBuffWrite: freezeDomains([
    DATA_DOMAIN.eventBuffs,
  ]),
  goalWrite: freezeDomains([
    DATA_DOMAIN.goals,
    DATA_DOMAIN.competitiveArenas,
    DATA_DOMAIN.tasks,
    DATA_DOMAIN.recommender,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  goalEvidenceWrite: freezeDomains([
    DATA_DOMAIN.goals,
    DATA_DOMAIN.competitiveArenas,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.contributionRoad,
  ]),
  goalLinkWrite: freezeDomains([
    DATA_DOMAIN.goals,
    DATA_DOMAIN.tasks,
    DATA_DOMAIN.recommender,
    DATA_DOMAIN.eventTrackers,
  ]),
  dailyLifecycleWrite: freezeDomains([
    DATA_DOMAIN.dailyLifecycle,
    DATA_DOMAIN.eventBuffs,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  eventAnalyticsWrite: freezeDomains([
    DATA_DOMAIN.eventAnalytics,
    DATA_DOMAIN.eventTrackers,
  ]),
  eventWrite: freezeDomains([
    DATA_DOMAIN.events,
    DATA_DOMAIN.eventTrackers,
    DATA_DOMAIN.eventBuffs,
    DATA_DOMAIN.goals,
    DATA_DOMAIN.dailyLifecycle,
    DATA_DOMAIN.eventAnalytics,
    DATA_DOMAIN.competitiveArenas,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.contributionRoad,
  ]),
  achievementWrite: freezeDomains([
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.contributionRoad,
  ]),
  reminderWrite: freezeDomains([
    DATA_DOMAIN.reminders,
    DATA_DOMAIN.dailyLifecycle,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  profileWrite: freezeDomains([
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.social,
    DATA_DOMAIN.leaderboards,
    DATA_DOMAIN.achievements,
    DATA_DOMAIN.socialWorld,
    DATA_DOMAIN.contributionRoad,
  ]),
  profileContextWrite: freezeDomains([
    DATA_DOMAIN.profileContext,
    DATA_DOMAIN.socialWorld,
    DATA_DOMAIN.profiles,
  ]),
  nextMoveWrite: freezeDomains([
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.tasks,
  ]),
  chronicleWrite: freezeDomains([
    DATA_DOMAIN.chronicle,
    DATA_DOMAIN.journals,
    DATA_DOMAIN.feed,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.profileSummaries,
    DATA_DOMAIN.nextMove,
    DATA_DOMAIN.contributionRoad,
  ]),
  chronicleStoryWrite: freezeDomains([
    DATA_DOMAIN.chronicle,
    DATA_DOMAIN.feed,
    DATA_DOMAIN.profiles,
    DATA_DOMAIN.contributionRoad,
  ]),
  chronicleReactionWrite: freezeDomains([
    DATA_DOMAIN.chronicle,
    DATA_DOMAIN.feed,
    DATA_DOMAIN.contributionRoad,
  ]),
  chronicleResponseWrite: freezeDomains([
    DATA_DOMAIN.chronicle,
    DATA_DOMAIN.feed,
    DATA_DOMAIN.social,
    DATA_DOMAIN.contributionRoad,
  ]),
  chronicleDraftWrite: freezeDomains([
    DATA_DOMAIN.chronicle,
  ]),
  chronicleVisibilityWrite: freezeDomains([
    DATA_DOMAIN.chronicle,
    DATA_DOMAIN.feed,
    DATA_DOMAIN.profiles,
  ]),
});

export function createDomainRevisions(initialValue = 0) {
  const revision = Number.isFinite(Number(initialValue)) ? Number(initialValue) : 0;
  return Object.fromEntries(DATA_DOMAINS.map((domain) => [domain, revision]));
}

export function normalizeDataDomains(domains) {
  const source = Array.isArray(domains) ? domains.flat(Infinity) : [domains];
  return [...new Set(source.filter((domain) => DATA_DOMAIN_SET.has(domain)))];
}

export function bumpDomainRevisions(current, domains = DATA_DOMAINS) {
  const normalized = normalizeDataDomains(domains);
  if (normalized.length === 0) return current;
  const next = { ...createDomainRevisions(), ...(current || {}) };
  for (const domain of normalized) {
    next[domain] = Number(next[domain] || 0) + 1;
  }
  return next;
}
