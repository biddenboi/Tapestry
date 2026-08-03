export const LOCAL_SECTION_ROUTES = Object.freeze({
  tasks: Object.freeze(['now', 'queue', 'all', 'planning', 'history']),
  goals: Object.freeze(['overview', 'areas', 'reviews', 'completed']),
  goal: Object.freeze(['overview', 'roadmap', 'activity', 'people', 'review-settings']),
  profile: Object.freeze(['overview', 'context', 'history', 'competition', 'identity']),
  match: Object.freeze(['arena', 'current']),
  events: Object.freeze(['calendar', 'rhythms', 'boundaries', 'reviews']),
  feed: Object.freeze(['recent', 'wander', 'stories', 'essays']),
  chronicle: Object.freeze(['latest', 'stories', 'essays', 'revisit', 'archive']),
  shop: Object.freeze(['featured', 'browse', 'collections', 'history']),
  inventory: Object.freeze(['equipped', 'collection', 'themes', 'identity']),
  settings: Object.freeze(['general', 'appearance', 'notifications', 'privacy', 'accessibility', 'data', 'advanced']),
  achievements: Object.freeze(['overview', 'journeys', 'records', 'collections', 'legacy']),
});

export function createLocalRoute({
  panel,
  section = panel,
  page,
  entityType = null,
  entityUUID = null,
  focusTarget = null,
  routeLabel = null,
  returnRoute = null,
} = {}) {
  const valid = LOCAL_SECTION_ROUTES[section] || [];
  if (!panel || !valid.includes(page)) {
    throw new Error(`Unknown local route: ${section || panel}/${page || ''}`);
  }
  return Object.freeze({
    panel,
    entityType,
    entityUUID,
    subview: page,
    focusTarget,
    routeLabel: routeLabel || `${section} / ${page}`,
    returnRoute,
  });
}

export function routeForNextMoveCandidate(candidate = {}) {
  if (candidate.route?.panel && candidate.route?.subview) return candidate.route;
  const entityUUID = candidate.entityUUID || candidate.targetUUID || null;
  switch (candidate.type) {
    case 'task-plan':
    case 'task-clarification':
      return createLocalRoute({
        panel: 'tasks',
        section: 'tasks',
        page: 'planning',
        entityType: 'task',
        entityUUID,
        focusTarget: candidate.focusTarget || 'next-action',
        routeLabel: 'Tasks / Planning',
      });
    case 'goal-review':
      return createLocalRoute({
        panel: 'events',
        section: 'goal',
        page: 'review-settings',
        entityType: 'goal',
        entityUUID,
        focusTarget: candidate.focusTarget || 'check-in',
        routeLabel: 'Goal / Review & Settings',
      });
    case 'goal-milestone':
      return createLocalRoute({
        panel: 'events',
        section: 'goal',
        page: 'roadmap',
        entityType: 'goal',
        entityUUID,
        focusTarget: candidate.focusTarget || 'milestone',
        routeLabel: 'Goal / Roadmap',
      });
    case 'verify-save':
      return createLocalRoute({
        panel: 'settings',
        section: 'settings',
        page: 'data',
        focusTarget: 'verify-save',
        routeLabel: 'Settings / Data & Backup',
      });
    default:
      return candidate.route || null;
  }
}
