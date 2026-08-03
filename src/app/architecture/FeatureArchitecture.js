export const FEATURE_ARCHITECTURE = Object.freeze({
  feed: Object.freeze({
    view: 'features/feed/components/Feed/Feed.jsx',
    controller: 'domain/feed/FeedOrdering.js',
    repository: 'data/persistence/repositories/FeedRepository.js',
    contracts: 'domain/feed/FeedOrdering.js',
    worker: null,
  }),
  shop: Object.freeze({
    view: 'features/shop/pages/Shop/Shop.jsx',
    controller: 'domain/shop/ShopPurchaseService.js',
    repository: 'data/persistence/repositories/ShopRepository.js',
    contracts: 'domain/shop/Shop.js',
    worker: null,
  }),
  map: Object.freeze({
    view: 'features/social-world/components/SocialWorldShell/SocialWorldScene.jsx',
    controller: 'features/social-world/controllers/SocialWorldSceneController.js',
    repository: 'data/persistence/sqlite/SqliteSocialWorldRepository.js',
    contracts: 'domain/social-world/SocialWorldContracts.js',
    worker: null,
  }),
  socialWorld: Object.freeze({
    view: 'features/social-world/components/SocialWorldShell/SocialWorldScene.jsx',
    controller: 'features/social-world/controllers/SocialWorldSceneController.js',
    repository: 'data/persistence/sqlite/SqliteSocialWorldRepository.js',
    contracts: 'domain/social-world/SocialWorldContracts.js',
    worker: null,
  }),
  matches: Object.freeze({
    view: 'features/matches/components/MatchArena/MatchArena.jsx',
    controller: 'domain/matches/MatchCompletionService.js',
    repository: 'data/persistence/repositories/MatchRepository.js',
    contracts: 'domain/matches/MatchContracts.js',
    worker: 'domain/matches/MatchPostMatchWorker.js',
  }),
  events: Object.freeze({
    view: 'features/events/pages/Events/Events.jsx',
    controller: 'domain/events/DailyLifecycleService.js',
    repository: 'domain/events/EventDomainRepository.js',
    contracts: 'domain/events/LifecycleBoundaries.js',
    worker: null,
  }),
  profiles: Object.freeze({
    view: 'features/profile/pages/Profile/Profile.jsx',
    controller: 'features/profile/pages/Profile/ProfileDataController.js',
    repository: 'data/persistence/repositories/ProfileRepository.js',
    contracts: 'domain/profile/ProfileSummary.js',
    worker: null,
  }),
  notes: Object.freeze({
    view: 'features/quick-notes/modals/QuickNotes/QuickNotes.jsx',
    controller: 'features/quick-notes/modals/QuickNotes/QuickNotesController.js',
    repository: 'features/quick-notes/modals/QuickNotes/quickNotesPersistence.js',
    contracts: 'features/quick-notes/modals/QuickNotes/QuickNotesController.js',
    worker: null,
  }),
  inbox: Object.freeze({
    view: 'features/inbox/components/Inbox/Inbox.jsx',
    controller: 'domain/notifications/InboxNotificationPolicy.js',
    repository: 'data/persistence/repositories/ProfileRepository.js',
    contracts: 'domain/notifications/InboxNotificationPolicy.js',
    worker: null,
  }),
});

export const FEATURE_ARCHITECTURE_FIELDS = Object.freeze([
  'view',
  'controller',
  'repository',
  'contracts',
  'worker',
]);
