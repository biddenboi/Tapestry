export const LOCAL_SECTION_ROUTES = Object.freeze({
  tasks: Object.freeze(['now', 'queue', 'all', 'planning', 'history']),
  goals: Object.freeze(['overview', 'areas', 'reviews', 'completed']),
  goal: Object.freeze(['overview', 'roadmap', 'activity', 'people', 'review-settings']),
  profile: Object.freeze(['overview', 'friends', 'history', 'competition', 'identity']),
  match: Object.freeze(['arena', 'current']),
  feed: Object.freeze(['journals']),
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
