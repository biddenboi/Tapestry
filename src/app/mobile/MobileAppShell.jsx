import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { useDayBoundaryAutomation } from '@app/day-boundary/useDayBoundaryAutomation.js';
import { GAME_STATE, STORES } from '@domain/constants.js';
import { Icon } from '@shared/icons/Icon.jsx';
import MobileBottomNavigation from './MobileBottomNavigation.jsx';
import MobileFeedbackLayer from './MobileFeedbackLayer.jsx';
import MobileOverlayHost from './MobileOverlayHost.jsx';
import MobileTasksPage from './MobileTasksPage.jsx';
import { MobileSurfaceProvider, useMobileSurface } from './MobileSurfaceContext.jsx';
import useVisualViewport from './useVisualViewport.js';
import './MobileAppShell.css';

const MobileChroniclePage = lazy(() => import('@features/chronicle/mobile/MobileChroniclePage.jsx'));
const MobileHabitsPage = lazy(() => import('@features/events/mobile/MobileHabitsPage.jsx'));
const MobileMorePage = lazy(() => import('@features/profile/mobile/MobileMorePage.jsx'));
const MobileShopPage = lazy(() => import('@features/shop/mobile/MobileShopPage.jsx'));

const LAST_TAB_KEY = 'tapestry.mobile.last-tab.v2';
const VALID_TABS = new Set(['tasks', 'habits', 'chronicle', 'shop', 'profile']);
const TAB_ROUTES = Object.freeze({
  tasks: 'today',
  habits: 'habits',
  chronicle: 'chronicle',
  shop: 'shop',
  profile: 'more',
});
const ROUTE_TABS = Object.freeze({
  ...Object.fromEntries(Object.entries(TAB_ROUTES).map(([key, value]) => [value, key])),
  goals: 'habits',
});

function tabFromLocation() {
  if (typeof window === 'undefined') return null;
  const route = window.location.hash.match(/^#\/m\/([^/?#]+)/)?.[1];
  return ROUTE_TABS[route] || null;
}

function initialTab(gameState) {
  if ([GAME_STATE.dojo, GAME_STATE.match].includes(gameState)) return 'profile';
  const routed = tabFromLocation();
  if (routed) return routed;
  const saved = typeof localStorage === 'undefined' ? '' : localStorage.getItem(LAST_TAB_KEY);
  return VALID_TABS.has(saved) ? saved : 'tasks';
}

function MobileShellContent() {
  const {
    databaseConnection,
    currentPlayer,
    currentPlayerLoaded,
    domainRevisions,
    gameState: [gameState, setGameState],
    activeMatch: [, setActiveMatch],
  } = useAppContext();
  const { primaryAction, surface, closeSurface, openSurface } = useMobileSurface();
  const [tab, setTab] = useState(() => initialTab(gameState));
  useVisualViewport();

  useDayBoundaryAutomation({
    databaseConnection,
    currentPlayer,
    currentPlayerLoaded,
    eventRevision: domainRevisions.dailyLifecycle,
    profileRevision: domainRevisions.profiles,
    onGateActiveChange: useCallback(() => undefined, []),
  });

  const selectTab = useCallback((next, { fromHistory = false, replace = false } = {}) => {
    if (!VALID_TABS.has(next)) return;
    if (gameState === GAME_STATE.dojo && next !== 'profile') {
      window.dispatchEvent(new CustomEvent('tapestry:mobile-arena-leave'));
      setGameState(GAME_STATE.idle);
    }
    if (surface) closeSurface({ force: true });
    setTab(next);
    localStorage.setItem(LAST_TAB_KEY, next);
    if (!fromHistory && typeof window !== 'undefined') {
      const url = `${window.location.pathname}${window.location.search}#/m/${TAB_ROUTES[next]}`;
      window.history[replace ? 'replaceState' : 'pushState']({ tapestryMobileTab: next }, '', url);
      window.dispatchEvent(new CustomEvent('tapestry:mobile-route-change', {
        detail: { route: TAB_ROUTES[next], tab: next },
      }));
    }
  }, [closeSurface, gameState, setGameState, surface]);

  useEffect(() => {
    const routed = tabFromLocation();
    if (!routed) selectTab(tab, { replace: true });
    const onPopState = () => {
      const next = tabFromLocation();
      if (next) selectTab(next, { fromHistory: true });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []); // Route initialization is intentionally one-shot.

  useEffect(() => {
    if ([GAME_STATE.dojo, GAME_STATE.match].includes(gameState) && tab !== 'profile') {
      selectTab('profile');
    }
  }, [gameState, selectTab, tab]);

  useEffect(() => {
    if (!currentPlayerLoaded || !currentPlayer?.UUID) return;
    const parameters = new URLSearchParams(window.location.search);
    const intent = parameters.get('open');
    if (!intent) return;
    parameters.delete('open');
    const query = parameters.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    const separator = intent.indexOf(':');
    const kind = separator < 0 ? intent : intent.slice(0, separator);
    const entityId = separator < 0 ? '' : intent.slice(separator + 1);
    if (!entityId) return;
    const openRecord = async () => {
      if (kind === 'match') {
        const match = await databaseConnection.get(STORES.match, entityId);
        if (!match) return;
        setActiveMatch(match);
        setGameState(GAME_STATE.match);
        selectTab('profile');
        return;
      }
      if (kind === 'task') {
        const task = await databaseConnection.get(STORES.todo, entityId)
          || await databaseConnection.get(STORES.task, entityId);
        if (task) {
          selectTab('tasks');
          openSurface('task-actions', { task });
        }
        return;
      }
      if (kind === 'reminder') {
        const reminder = await databaseConnection.get(STORES.reminder, entityId);
        if (reminder) {
          selectTab('tasks');
          openSurface('reminder-actions', { reminder });
        }
      }
    };
    void openRecord().catch((error) => console.warn('[Mobile] notification destination could not be opened:', error));
  }, [currentPlayer?.UUID, currentPlayerLoaded, databaseConnection, openSurface, selectTab, setActiveMatch, setGameState]);

  const panels = [
    ['tasks', <MobileTasksPage />],
    ['habits', <MobileHabitsPage />],
    ['chronicle', <MobileChroniclePage />],
    ['shop', <MobileShopPage />],
    ['profile', <MobileMorePage />],
  ];

  return (
    <div className="mobile-app-shell" data-mobile-tab={tab}>
      <main className="mobile-app-content">
        {panels.map(([id, content]) => (
          <section key={id} className="mobile-tab-panel" hidden={tab !== id} aria-hidden={tab !== id} data-mobile-panel={id}>
            <Suspense fallback={<div className="mobile-feature-loading">Opening {TAB_ROUTES[id]}…</div>}>{content}</Suspense>
          </section>
        ))}
      </main>
      <MobileBottomNavigation value={tab} onChange={selectTab} />
      {tab === 'tasks' && !surface && primaryAction && (
        <button type="button" className="mobile-shell-fab" onClick={primaryAction.onInvoke} aria-label={primaryAction.label}>
          <Icon name="add" size={24} />
        </button>
      )}
      <MobileFeedbackLayer />
      <MobileOverlayHost />
    </div>
  );
}

export default function MobileAppShell() {
  return <MobileSurfaceProvider><MobileShellContent /></MobileSurfaceProvider>;
}
