const WORLD_LOCATION_BY_ROUTE = Object.freeze({
  commons: 'commons',
  lobby: 'commons',
  hub: 'commons',
  feed: 'commons',
  tasks: 'task-session',
  queue: 'task-session',
  events: 'planning',
  planning: 'planning',
  dojo: 'dojo',
  practice: 'dojo',
  match: 'match-arena',
  'match-arena': 'match-arena',
  inventory: 'marketplace',
  shop: 'marketplace',
  marketplace: 'marketplace',
});

const PANEL_BY_WORLD_LOCATION = Object.freeze({
  commons: 'hub',
  planning: 'events',
  'task-session': 'tasks',
  dojo: 'hub',
  'match-arena': 'hub',
  marketplace: 'inventory',
});

export function resolveWorldRouteLocationId(locationId) {
  const normalized = String(locationId || '').trim().toLowerCase();
  return WORLD_LOCATION_BY_ROUTE[normalized] || normalized || null;
}

export function worldRouteTargetsPanel(locationId, panelId) {
  return PANEL_BY_WORLD_LOCATION[resolveWorldRouteLocationId(locationId)] === panelId;
}

export function showWorldRoute(setWorldRoute, destination) {
  if (typeof setWorldRoute !== 'function') return;
  setWorldRoute(destination ? {
    locationId: resolveWorldRouteLocationId(destination.worldLocationId || destination.panel),
    label: destination.routeLabel || destination.panel,
    recommendationId: [
      destination.panel,
      destination.entityType,
      destination.entityUUID,
      destination.subview,
      destination.focusTarget,
    ].filter(Boolean).join(':'),
  } : null);
}

export function clearWorldRoute(setWorldRoute) {
  if (typeof setWorldRoute === 'function') setWorldRoute(null);
}
