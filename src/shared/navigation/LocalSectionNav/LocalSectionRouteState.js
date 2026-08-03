import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORES } from '@domain/constants.js';

export const LOCAL_ROUTE_PREFERENCE_VERSION = 1;

export const LEGACY_LOCAL_ROUTE_MAP = Object.freeze({
  tasks: Object.freeze({
    upcoming: 'planning',
    today: 'all',
    todos: 'all',
    reminders: 'planning',
  }),
  profile: Object.freeze({
    timeline: 'history',
    matches: 'competition',
    social: 'context',
    settings: 'identity',
  }),
  events: Object.freeze({
    events: 'calendar',
    habits: 'rhythms',
    goals: 'reviews',
  }),
  inventory: Object.freeze({
    all: 'collection',
    cosmetics: 'collection',
  }),
  feed: Object.freeze({
    recent: 'recent',
    global: 'global',
    stories: 'stories',
    essays: 'essays',
    wander: 'wander',
    yours: 'yours',
    latest: 'yours',
    revisit: 'yours',
    archive: 'yours',
  }),
  'feed-yours': Object.freeze({
    latest: 'active',
    moments: 'active',
    active: 'active',
    drafts: 'drafts',
    revisit: 'revisit',
    archive: 'archive',
  }),
});

export function resolveLocalPageId(sectionId, requested, pages = [], fallback = null) {
  const validIds = new Set(pages.map((page) => String(page.id)));
  const value = String(requested || '');
  if (validIds.has(value)) return value;
  const mapped = LEGACY_LOCAL_ROUTE_MAP[sectionId]?.[value];
  if (mapped && validIds.has(mapped)) return mapped;
  const fallbackId = fallback || pages[0]?.id || null;
  return fallbackId && validIds.has(String(fallbackId)) ? String(fallbackId) : null;
}

export function localRoutePreferenceId(profileUUID, sectionId) {
  return `local-route:${profileUUID || 'anonymous'}:${sectionId}`;
}

export function createLocalRoutePreference({
  profileUUID,
  sectionId,
  pageId,
  filters = {},
  scroll = {},
  selectedEntityUUID = null,
  now = new Date(),
} = {}) {
  return {
    UUID: localRoutePreferenceId(profileUUID, sectionId),
    parent: profileUUID || null,
    version: LOCAL_ROUTE_PREFERENCE_VERSION,
    sectionId,
    pageId,
    filters,
    scroll,
    selectedEntityUUID,
    updatedAt: now.toISOString(),
  };
}

export function useLocalSectionRoute({
  sectionId,
  pages,
  profileUUID,
  databaseConnection = null,
  routeIntent = null,
  defaultPageId = null,
  onIntentConsumed = null,
  onPageChange = null,
}) {
  const [activePageId, setActivePageId] = useState(() => resolveLocalPageId(
    sectionId,
    routeIntent?.subview,
    pages,
    defaultPageId,
  ));
  const [restored, setRestored] = useState(false);
  const latestRef = useRef(activePageId);
  const intentRef = useRef(null);
  latestRef.current = activePageId;

  const pageIds = useMemo(() => pages.map((page) => page.id).join('|'), [pages]);

  useEffect(() => {
    let cancelled = false;
    if (!databaseConnection || !profileUUID) {
      setRestored(true);
      return undefined;
    }
    Promise.all([
      databaseConnection.navigationPreferences?.get(profileUUID, sectionId).catch(() => null),
      databaseConnection.get(
        STORES.appSetting,
        localRoutePreferenceId(profileUUID, sectionId),
      ).catch(() => null),
    ]).then(([typed, stored]) => {
      if (cancelled) return;
      const requested = routeIntent?.subview
        || typed?.pageId
        || stored?.value?.pageId
        || stored?.pageId;
      setActivePageId(resolveLocalPageId(sectionId, requested, pages, defaultPageId));
      setRestored(true);
    }).catch(() => {
      if (!cancelled) setRestored(true);
    });
    return () => { cancelled = true; };
  }, [databaseConnection, defaultPageId, pageIds, profileUUID, sectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!routeIntent?.intentId || intentRef.current === routeIntent.intentId) return;
    const requested = resolveLocalPageId(sectionId, routeIntent.subview, pages, defaultPageId);
    if (!requested) return;
    intentRef.current = routeIntent.intentId;
    setActivePageId(requested);
    onIntentConsumed?.(routeIntent.intentId);
  }, [defaultPageId, onIntentConsumed, pageIds, pages, routeIntent, sectionId]);

  useEffect(() => {
    if (!restored || !databaseConnection || !profileUUID || !activePageId) return;
    const preference = createLocalRoutePreference({
      profileUUID,
      sectionId,
      pageId: activePageId,
    });
    databaseConnection.add(STORES.appSetting, {
      ...preference,
      value: preference,
    }).catch((error) => console.warn('[LocalSectionRouteState] preference write failed:', error));
    databaseConnection.navigationPreferences?.save(preference)
      .catch((error) => console.warn('[LocalSectionRouteState] typed preference write failed:', error));
  }, [activePageId, databaseConnection, profileUUID, restored, sectionId]);

  useEffect(() => {
    if (!activePageId) return;
    onPageChange?.(sectionId, activePageId);
  }, [activePageId, onPageChange, sectionId]);

  const selectPage = useCallback((nextPageId) => {
    setActivePageId(resolveLocalPageId(sectionId, nextPageId, pages, defaultPageId));
  }, [defaultPageId, pages, sectionId]);

  return { activePageId, selectPage, restored };
}
