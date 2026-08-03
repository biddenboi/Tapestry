export function createPanelNavigationFrame(route = {}, currentProfileUUID = null) {
  return {
    ...route,
    panel: route.panel || null,
    subview: route.subview || route.subpage || null,
    entityType: route.entityType || null,
    entityUUID: route.entityUUID || route.profileUUID || null,
    profileUUID: route.profileUUID || currentProfileUUID || null,
  };
}

export function isSamePanelNavigationFrame(left = {}, right = {}) {
  return String(left.panel || '') === String(right.panel || '')
    && String(left.subview || '') === String(right.subview || '')
    && String(left.entityType || '') === String(right.entityType || '')
    && String(left.entityUUID || '') === String(right.entityUUID || '')
    && String(left.profileUUID || '') === String(right.profileUUID || '');
}

export function pushPanelNavigationFrame(history = [], current = null, destination = null) {
  if (!current?.panel || isSamePanelNavigationFrame(current, destination)) return [...history];
  return [...history, current];
}

export function popPanelNavigationFrame(history = []) {
  if (!history.length) return { history: [], frame: null };
  return {
    history: history.slice(0, -1),
    frame: history.at(-1),
  };
}

