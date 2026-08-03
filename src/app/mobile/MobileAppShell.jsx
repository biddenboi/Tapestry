import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { useDayBoundaryAutomation } from '@app/day-boundary/useDayBoundaryAutomation.js';
import { GAME_STATE } from '@domain/constants.js';
import { Icon } from '@shared/icons/Icon.jsx';
import { loadEndDayConfirm, loadWakePopup } from '@features/events/loaders.js';
import ActiveStateController from './ActiveStateController.jsx';
import MobileBottomNavigation from './MobileBottomNavigation.jsx';
import MobileFeedbackLayer from './MobileFeedbackLayer.jsx';
import MobileOverlayHost from './MobileOverlayHost.jsx';
import MobileTasksPage from './MobileTasksPage.jsx';
import { MobileSurfaceProvider, useMobileSurface } from './MobileSurfaceContext.jsx';
import useVisualViewport from './useVisualViewport.js';
import './MobileAppShell.css';

const MobileChroniclePage = lazy(() => import('@features/chronicle/mobile/MobileChroniclePage.jsx'));
const MobileGoalsPage = lazy(() => import('@features/goals/mobile/MobileGoalsPage.jsx'));
const MobileMorePage = lazy(() => import('@features/profile/mobile/MobileMorePage.jsx'));
const MobileShopPage = lazy(() => import('@features/shop/mobile/MobileShopPage.jsx'));

const LAST_TAB_KEY = 'tapestry.mobile.last-tab.v2';
const VALID_TABS = new Set(['tasks', 'goals', 'chronicle', 'shop', 'profile']);
const TAB_ROUTES = Object.freeze({
  tasks: 'today',
  goals: 'goals',
  chronicle: 'chronicle',
  shop: 'shop',
  profile: 'more',
});
const ROUTE_TABS = Object.freeze(Object.fromEntries(Object.entries(TAB_ROUTES).map(([key, value]) => [value, key])));

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
  } = useAppContext();
  const { primaryAction, surface, closeSurface } = useMobileSurface();
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
    if (surface) closeSurface({ force: true });
    setTab(next);
    localStorage.setItem(LAST_TAB_KEY, next);
    if (!fromHistory && typeof window !== 'undefined') {
      const url = `${window.location.pathname}${window.location.search}#/m/${TAB_ROUTES[next]}`;
      window.history[replace ? 'replaceState' : 'pushState']({ tapestryMobileTab: next }, '', url);
    }
  }, [closeSurface, surface]);

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

  const openActive = async (session) => {
    if (session.routineType) {
      selectTab('profile');
      const Modal = session.routineType === 'day' ? await loadWakePopup() : await loadEndDayConfirm();
      await NiceModal.show(Modal, { origin: 'mobile' });
      return;
    }
    if (session.matchUUID) setGameState(GAME_STATE.match);
    else if (session.dojoSessionUUID) setGameState(GAME_STATE.dojo);
    selectTab(session.matchUUID || session.dojoSessionUUID ? 'profile' : 'tasks');
  };

  const panels = [
    ['tasks', <MobileTasksPage />],
    ['goals', <MobileGoalsPage />],
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
      <ActiveStateController onOpen={openActive} />
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
