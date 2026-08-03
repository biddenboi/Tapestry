export function normalizeNavigationRoute(route = {}) {
  if (!route.panel) throw new Error('Navigation routes require a panel.');
  return Object.freeze({
    panel: String(route.panel),
    entityType: route.entityType ? String(route.entityType) : null,
    entityUUID: route.entityUUID ? String(route.entityUUID) : null,
    subview: route.subview ? String(route.subview) : null,
    focusTarget: route.focusTarget ? String(route.focusTarget) : null,
    routeLabel: String(route.routeLabel || route.panel),
    worldLocationId: String(route.worldLocationId || route.panel),
    returnRoute: route.returnRoute || null,
  });
}

export function followNavigationRoute(openRoute, route) {
  if (typeof openRoute !== 'function') throw new Error('A route opener is required.');
  return openRoute(normalizeNavigationRoute(route));
}
