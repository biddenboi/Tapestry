import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import DomainHydrationBoundary from '@app/data-source/DomainHydrationBoundary.jsx';
import { domainsForPanel } from '@app/data-source/panelDomainRequirements.js';
import {
  markActivePanelReady,
  markShellReady,
  markStartup,
  markStartupSettled,
  registerStaticModule,
} from '@shared/performance/startupPerf.js';
import { EVENT, GAME_STATE } from '@domain/constants.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getPlayerRankPresentation } from '@domain/rank/Rank.js';
import { useScheduledDeadline } from '@shared/hooks/useScheduledDeadline.js';
import { loadEndDayConfirm } from '@features/events/loaders.js';
import {
  ContributionPass,
  Events,
  Feed,
  Inbox,
  Inventory,
  Lobby,
  MatchArena,
  PracticeDojo,
  Profile,
  Shop,
  Settings,
  TodoList,
  SocialWorldShell,
  loadReminderModal,
} from '@app/shell/GameHub/panelRegistry.js';
import '@app/shell/GameHub/GameHub.css';
import PanelLoading from '@app/shell/GameHub/components/PanelLoading.jsx';
import ReminderNotificationStack from '@app/shell/GameHub/components/ReminderNotificationStack.jsx';
import HubPanelErrorBoundary from '@app/shell/GameHub/components/HubPanelErrorBoundary.jsx';
import { useDayBoundaryAutomation } from '@app/day-boundary/useDayBoundaryAutomation.js';
import { useInboxNotificationCount } from '@app/shell/GameHub/hooks/useInboxNotificationCount.js';
import { Icon } from '@shared/icons/Icon.jsx';
import DrawerFrame from '@shared/ui/DrawerFrame.jsx';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';
import {
  PanelLifecycleProvider,
} from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { usePanelLifecycleRegistry } from '@app/panel-lifecycle/usePanelLifecycleRegistry.js';
import {
  effectivePanelLifecycle,
  isPanelMounted,
} from '@app/panel-lifecycle/panelLifecycle.js';
import {
  getNextReminderDeadline,
} from '@app/shell/GameHub/panelScheduling.js';
import { getNextDailyLifecycleBoundary } from '@domain/events/LifecycleBoundaries.js';
import { getDurableEndOfDayState } from '@domain/events/DailyLifecycleService.js';
import { EVENT_TERMINOLOGY } from '@features/events/terminology.js';
import EdgeNextMoveHost from '@features/navigation/components/EdgeNextMoveHost/EdgeNextMoveHost.jsx';
import { worldRouteTargetsPanel } from '@features/navigation/services/WorldRouteHighlightService.js';
import QuickCaptureLauncher from '@features/chronicle/components/QuickCapture/QuickCaptureLauncher.jsx';
import useOpeningTrail from '@features/opening-trail/useOpeningTrail.js';
import {
  decideNotification,
  markInterventionOutcome,
  NOTIFICATION_CATEGORY,
} from '@domain/notifications/NotificationPolicy.js';

registerStaticModule('app/shell/GameHub');

const INVENTORY_CHILD_PANELS = new Set(['shop', 'pass']);
const PANEL_MODE_BY_ID = Object.freeze({ queue: 'tasks' });
const MANAGED_PANEL_IDS = Object.freeze([
  'map',
  'feed',
  'shop',
  'lobby',
  'events',
  'profiles',
  'inbox',
]);
const MANAGED_OVERLAY_PANEL_IDS = Object.freeze(['feed', 'shop', 'events', 'profiles']);
const ACTIVE_PANEL_LIFECYCLE_ID = Object.freeze({
  feed: 'feed',
  shop: 'shop',
  events: 'events',
  profile: 'profiles',
});

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPanelMode(panel) {
  return PANEL_MODE_BY_ID[panel] || panel || '';
}

const SIDEBAR_NAV = [
  { id: 'hub',       label: 'Lobby',     title: 'Lobby',             color: 'var(--color-match)' },
  { id: 'tasks',     label: 'Tasks',     title: 'Tasks',             color: 'var(--color-task)' },
  { id: 'events',    label: EVENT_TERMINOLOGY.navigation.label, title: EVENT_TERMINOLOGY.navigation.title, color: 'var(--color-event)' },
  { id: 'feed',      label: 'Feed',      title: 'Feed',              color: 'var(--color-feed)' },
  { id: 'inventory', label: 'Inventory', title: 'Inventory',         color: 'var(--color-inventory)' },
];

function PanelReadyMarker({ panel, state, readinessKey = state, onReady, children }) {
  useEffect(() => {
    if (state !== 'loading') return;
    markActivePanelReady(panel);
    onReady?.(panel);
  }, [onReady, panel, readinessKey, state]);
  return children;
}

function LifecyclePanel({ panelId, state, readinessKey, onReady, children }) {
  const canHydrate = state === 'loading' || state === 'active';
  return (
    <PanelLifecycleProvider panelId={panelId} state={state}>
      <DomainHydrationBoundary
        domains={domainsForPanel(panelId)}
        enabled={canHydrate}
        fallback={panelId === 'map' ? null : <PanelLoading />}
      >
        <PanelReadyMarker
          panel={panelId}
          state={state}
          readinessKey={readinessKey}
          onReady={onReady}
        >
          {children}
        </PanelReadyMarker>
      </DomainHydrationBoundary>
    </PanelLifecycleProvider>
  );
}

export default function GameHub() {
  const {
    databaseConnection,
    domainRevisions,
    ensureDomainLoaded,
    currentPlayer,
    currentPlayerLoaded,
    notify,
    invalidateDomains,
    activeTask: [activeTask, setActiveTask],
    gameState: [gameState, setGameState],
    activePanel: [activePanel],
    viewingProfile: [viewingProfile],
    routeIntent,
    consumeRouteIntent,
    worldRoute,
    openPanel,
    replacePanel,
    closePanel,
    playSound,
  } = useAppContext();
  const openingTrail = useOpeningTrail();

  const notifyRef = useRef(notify);
  useEffect(() => { notifyRef.current = notify; }, [notify]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [dueReminders, setDueReminders] = useState([]);
  const [upcomingReminders, setUpcomingReminders] = useState([]);
  const [nextReminderAt, setNextReminderAt] = useState(null);
  const [dayBoundary, setDayBoundary] = useState(() => getNextDailyLifecycleBoundary(null));
  const [dayBoundaryTick, setDayBoundaryTick] = useState(0);
  const [dayGateActive, setDayGateActive] = useState(false);
  const unreadCount = useInboxNotificationCount({
    databaseConnection,
    player: currentPlayer,
    socialRevision: domainRevisions.social,
  });
  const worldAllowedMarkedRef = useRef(false);
  const sleepBoundaryShownRef = useRef(null);
  const {
    states: panelLifecycleStates,
    activate: activatePanelLifecycle,
    ready: markPanelLifecycleReady,
    suspend: suspendPanelLifecycle,
  } = usePanelLifecycleRegistry(MANAGED_PANEL_IDS);

  const managedOverlayPanelId = ACTIVE_PANEL_LIFECYCLE_ID[activePanel] || null;
  const worldShouldBeActive = !dayGateActive
    && currentPlayerLoaded
    && gameState === GAME_STATE.idle
    && !activePanel
    && !lobbyOpen
    && !inboxOpen;

  useEffect(() => {
    markStartup('gamehub-mounted');
    markShellReady();
  }, []);

  useEffect(() => {
    if (!currentPlayerLoaded) return undefined;
    const timer = window.setTimeout(() => {
      markStartupSettled({ hasPlayer: !!currentPlayer?.UUID });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [currentPlayer?.UUID, currentPlayerLoaded]);
  useEffect(() => {
    if (dayGateActive || !currentPlayerLoaded || worldAllowedMarkedRef.current) return;
    worldAllowedMarkedRef.current = true;
    markStartup('semantic-world-layer-allowed');
  }, [currentPlayerLoaded, dayGateActive]);

  useEffect(() => {
    for (const panelId of MANAGED_OVERLAY_PANEL_IDS) {
      if (panelId === managedOverlayPanelId) activatePanelLifecycle(panelId);
      else suspendPanelLifecycle(panelId);
    }
  }, [activatePanelLifecycle, managedOverlayPanelId, suspendPanelLifecycle]);

  useEffect(() => {
    if (lobbyOpen) activatePanelLifecycle('lobby');
    else suspendPanelLifecycle('lobby');
  }, [activatePanelLifecycle, lobbyOpen, suspendPanelLifecycle]);

  useEffect(() => {
    if (inboxOpen) activatePanelLifecycle('inbox');
    else suspendPanelLifecycle('inbox');
  }, [activatePanelLifecycle, inboxOpen, suspendPanelLifecycle]);

  useEffect(() => {
    if (worldShouldBeActive) activatePanelLifecycle('map');
    else suspendPanelLifecycle('map', { dispose: false });
  }, [activatePanelLifecycle, suspendPanelLifecycle, worldShouldBeActive]);

  useEffect(() => {
    setDayBoundary(getNextDailyLifecycleBoundary(currentPlayer));
  }, [currentPlayer?.UUID, currentPlayer?.sleepTime, currentPlayer?.wakeTime]);

  useScheduledDeadline(() => {
    const crossedBoundary = dayBoundary;
    ensureDomainLoaded('dailyLifecycle')
      .then(async () => {
        setDayBoundaryTick((tick) => tick + 1);
        if (
          crossedBoundary.type !== 'sleep'
          || !currentPlayer?.UUID
          || dayGateActive
        ) return;
        const boundaryKey = `${currentPlayer.UUID}:${crossedBoundary.at}`;
        if (sleepBoundaryShownRef.current === boundaryKey) return;

        const eodDateStr = localDateKey(crossedBoundary.at);
        const [endOfDayState, lastSleep] = await Promise.all([
          getDurableEndOfDayState(
            databaseConnection,
            currentPlayer.UUID,
            eodDateStr,
          ),
          databaseConnection.getLastEventType([EVENT.sleep], currentPlayer.UUID),
        ]);
        if (
          endOfDayState
          || (lastSleep?.createdAt && localDateKey(lastSleep.createdAt) === eodDateStr)
        ) return;

        sleepBoundaryShownRef.current = boundaryKey;
        const EndDayConfirm = await loadEndDayConfirm();
        await NiceModal.show(EndDayConfirm);
      })
      .catch((error) => console.warn('[GameHub] lifecycle boundary hydration failed:', error));
    setDayBoundary(getNextDailyLifecycleBoundary(currentPlayer, new Date(Date.now() + 1000)));
  }, dayBoundary.at, { enabled: gameState !== GAME_STATE.match });
  useEffect(() => {
    const openProfileFromWorld = (profileUUID) => {
      if (!profileUUID) return;
      setInboxOpen(false);
      setLobbyOpen(false);
      openPanel('profile', profileUUID);
    };

    const handleProfileHash = () => {
      const hash = window.location.hash || '';
      if (!hash.startsWith('#profile:')) return;
      const profileUUID = decodeURIComponent(hash.slice('#profile:'.length));
      openProfileFromWorld(profileUUID);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };

    const handleWorldProfileOpen = (event) => {
      openProfileFromWorld(event.detail?.profileUUID);
    };
    window.addEventListener('tapestry:open-profile', handleWorldProfileOpen);
    window.addEventListener('hashchange', handleProfileHash);
    handleProfileHash();
    return () => {
      window.removeEventListener('tapestry:open-profile', handleWorldProfileOpen);
      window.removeEventListener('hashchange', handleProfileHash);
    };
  }, [openPanel]);

  const refreshDueReminders = useCallback(async () => {
    if (!currentPlayer?.UUID) {
      setDueReminders([]);
      setUpcomingReminders([]);
      setNextReminderAt(null);
      return;
    }
    const [due, upcoming] = await Promise.all([
      databaseConnection.getDueReminders(currentPlayer.UUID),
      databaseConnection.getUpcomingReminders(currentPlayer.UUID, { limit: 64 }),
    ]);
    const decisions = await Promise.all(due.map(async (reminder) => {
      const candidate = {
        type: reminder.category && Object.values(NOTIFICATION_CATEGORY).includes(reminder.category)
          ? reminder.category
          : reminder.dueDate
            ? NOTIFICATION_CATEGORY.externalDeadline
            : NOTIFICATION_CATEGORY.plannedOpportunity,
        targetUUID: reminder.targetUUID || reminder.UUID,
        specificAction: reminder.title || reminder.body,
        isPossibleNow: reminder.blocked !== true,
        decisionPoint: 'due-reminder',
      };
      const decision = await decideNotification(databaseConnection, currentPlayer, candidate, {
        activeSession: !!activeTask?.createdAt,
        activeMatch: gameState === GAME_STATE.match,
        activeDojo: gameState === GAME_STATE.dojo,
      });
      return decision.decision === 'deliver' ? { ...reminder, interventionDecision: decision } : null;
    }));
    setDueReminders(decisions.filter(Boolean).slice(0, 2));
    setUpcomingReminders(upcoming.slice(0, 3));
    setNextReminderAt(getNextReminderDeadline(upcoming));
  }, [activeTask?.createdAt, currentPlayer, databaseConnection, gameState]);

  useEffect(() => {
    if (dayGateActive) {
      setNextReminderAt(null);
      return;
    }
    refreshDueReminders().catch((error) => console.warn('[GameHub] reminder load failed:', error));
  }, [domainRevisions.reminders, dayGateActive, refreshDueReminders]);

  useScheduledDeadline(() => {
    refreshDueReminders().catch((error) => console.warn('[GameHub] reminder deadline failed:', error));
  }, nextReminderAt, {
    enabled: !dayGateActive && gameState !== GAME_STATE.match,
  });

  const openReminderToast = useCallback((reminder) => {
    if (!reminder?.UUID) return;
    if (reminder.interventionDecision?.UUID) {
      markInterventionOutcome(databaseConnection, reminder.interventionDecision.UUID, {
        openedAt: new Date().toISOString(),
      }).catch((error) => console.warn('[GameHub] reminder open ledger failed:', error));
    }
    loadReminderModal()
      .then((ReminderModal) => NiceModal.show(ReminderModal, {
        reminder,
        onSaved: async () => {
          await refreshDueReminders();
          invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
        },
      }))
      .catch((error) => console.warn('[GameHub] reminder modal failed:', error));
  }, [databaseConnection, invalidateDomains, refreshDueReminders]);

  const dismissReminderToast = useCallback(async (reminder) => {
    if (!reminder?.UUID) return;
    try {
      if (reminder.interventionDecision?.UUID) {
        await markInterventionOutcome(databaseConnection, reminder.interventionDecision.UUID, {
          dismissedAt: new Date().toISOString(),
        });
      }
      await databaseConnection.dismissReminder(reminder.UUID);
      await refreshDueReminders();
      invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
    } catch (error) {
      console.warn('[GameHub] reminder dismiss failed:', error);
    }
  }, [databaseConnection, invalidateDomains, refreshDueReminders]);

  useDayBoundaryAutomation({
    databaseConnection,
    currentPlayer,
    currentPlayerLoaded,
    eventRevision: domainRevisions.dailyLifecycle,
    profileRevision: domainRevisions.profiles,
    eventsAvailable: !databaseConnection.isPartiallyLoaded?.()
      || databaseConnection.isDomainLoaded?.('dailyLifecycle'),
    dayBoundaryTick,
    notifyRef,
    onGateActiveChange: setDayGateActive,
  });

  const handleNavClick = (id) => {
    setInboxOpen(false);
    if (id === 'hub') {
      if (activePanel) replacePanel(null);
      setLobbyOpen((open) => {
        if (!open) playSound?.('lobby-open', { volume: 0.8, throttleMs: 280 });
        return !open;
      });
      return;
    }
    if (id === 'tasks') {
      setLobbyOpen(false);
      if (activePanel === 'tasks') {
        replacePanel(null);
        return;
      }
      replacePanel('tasks');
      return;
    }
    setLobbyOpen(false);
    if (activePanel === id) { replacePanel(null); return; }
    replacePanel(id);
  };

  const toggleInbox = () => {
    setLobbyOpen(false);
    setInboxOpen((v) => !v);
    if (activePanel) replacePanel(null);
  };

  useEffect(() => {
    if (gameState !== GAME_STATE.idle) setLobbyOpen(false);
  }, [gameState]);

  useEffect(() => {
    if (!activePanel) return undefined;
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activePanel, closePanel]);

  useEffect(() => {
    if (!routeIntent?.intentId || routeIntent.panel !== activePanel) return;
    const frame = requestAnimationFrame(() => consumeRouteIntent(routeIntent.intentId));
    return () => cancelAnimationFrame(frame);
  }, [activePanel, consumeRouteIntent, routeIntent]);

  const renderFocusOverlay = () => {
    if (gameState === GAME_STATE.match) {
      return (
        <div className="hub-focus-overlay" data-traversal-surface="match">
          <DomainHydrationBoundary domains={domainsForPanel('match')} fallback={<PanelLoading />}>
            <MatchArena />
          </DomainHydrationBoundary>
        </div>
      );
    }
    if (gameState === GAME_STATE.dojo) {
      return (
        <div className="hub-focus-overlay" data-traversal-surface="dojo">
          <DomainHydrationBoundary domains={domainsForPanel('dojo')} fallback={<PanelLoading />}>
            <PracticeDojo />
          </DomainHydrationBoundary>
        </div>
      );
    }
    return null;
  };

  const deferWorldLayer = dayGateActive
    || !currentPlayerLoaded
    || gameState !== GAME_STATE.idle
    || !!activePanel
    || lobbyOpen
    || inboxOpen;

  const renderWorldLayer = () => (
    <LifecyclePanel
      panelId="map"
      state={effectivePanelLifecycle(panelLifecycleStates.map, !deferWorldLayer)}
      readinessKey={panelLifecycleStates.map}
      onReady={markPanelLifecycleReady}
    >
      <SocialWorldShell deferHeavyWork={deferWorldLayer} />
    </LifecyclePanel>
  );

  const renderManagedContent = (panelId) => {
    if (panelId === 'events') return <Events />;
    if (panelId === 'feed') return <Feed />;
    if (panelId === 'shop') return <Shop />;
    if (panelId === 'profiles') {
      return <Profile uuid={viewingProfile || currentPlayer?.UUID} />;
    }
    if (panelId === 'lobby') {
      return (
        <Lobby
          reminders={upcomingReminders}
          onOpenReminder={openReminderToast}
          onDismissReminder={dismissReminderToast}
        />
      );
    }
    if (panelId === 'inbox') return <Inbox onClose={() => setInboxOpen(false)} />;
    return null;
  };

  const renderManagedPanel = (panelId, visible) => {
    const content = renderManagedContent(panelId);
    if (!content) return null;
    const state = effectivePanelLifecycle(panelLifecycleStates[panelId], visible);
    return (
      <LifecyclePanel
        panelId={panelId}
        state={state}
        readinessKey={panelLifecycleStates[panelId]}
        onReady={markPanelLifecycleReady}
      >
        {content}
      </LifecyclePanel>
    );
  };

  const renderPanel = () => {
    if (!activePanel) return null;
    let content = null;
    if (activePanel === 'tasks') {
      content = (
        <TodoList
          focusTaskId={routeIntent?.panel === 'tasks' ? routeIntent.entityUUID : null}
        />
      );
    }
    if (activePanel === 'queue') {
      content = (
        <TodoList
          fromQueue
          focusTaskId={routeIntent?.panel === 'queue' ? routeIntent.entityUUID : null}
        />
      );
    }
    if (managedOverlayPanelId) content = renderManagedPanel(managedOverlayPanelId, true);
    if (activePanel === 'pass')      content = <ContributionPass />;
    if (activePanel === 'inventory') content = <Inventory />;
    if (activePanel === 'settings') {
      content = <Settings routeIntent={routeIntent?.panel === 'settings' ? routeIntent : null} />;
    }
    if (!content) return null;

    const panelKey = activePanel === 'profile'
      ? `profile:${viewingProfile || currentPlayer?.UUID || 'self'}`
      : activePanel;

    return (
      <div className="hub-page" key={panelKey} data-traversal-page={panelKey}>
        <HubPanelErrorBoundary panelKey={panelKey}>
          {managedOverlayPanelId ? content : (
            <DomainHydrationBoundary
              domains={domainsForPanel(activePanel)}
              fallback={<PanelLoading />}
            >
              <PanelReadyMarker panel={activePanel} state="loading">
                {content}
              </PanelReadyMarker>
            </DomainHydrationBoundary>
          )}
        </HubPanelErrorBoundary>
      </div>
    );
  };

  const parkedPanelIds = MANAGED_OVERLAY_PANEL_IDS.filter((panelId) => (
    panelId !== managedOverlayPanelId && isPanelMounted(panelLifecycleStates[panelId])
  ));
  const lobbyVisible = lobbyOpen;
  const inboxVisible = inboxOpen;

  const {
    rankGlow,
    rankClass,
  } = getPlayerRankPresentation(currentPlayer, { glowSize: 14 });
  const panelMode = getPanelMode(activePanel);
  const isTaskPanel = panelMode === 'tasks';
  const isTaskExpanded = activePanel === 'queue' || activePanel === 'tasks';
  const panelClassName = [
    'hub-world-panel',
    panelMode ? `hub-world-panel--${panelMode}` : '',
    isTaskPanel && isTaskExpanded ? 'is-expanded' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`game-hub ${activeTask?.createdAt ? 'hub-in-session' : ''}`}>
      <main className="hub-main">
        <Suspense
          fallback={
            <div className="hub-world-boot" aria-live="polite">
              <span>Loading social world</span>
            </div>
          }
        >
          {renderWorldLayer()}
        </Suspense>
        <ReminderNotificationStack
          reminders={dueReminders}
          onOpen={openReminderToast}
          onDismiss={dismissReminderToast}
        />
        <div className={`hub-world-controls ${gameState !== GAME_STATE.idle ? 'is-focus-hidden' : ''}`} aria-label="World controls">
          <nav className="hub-world-nav" aria-label="Primary panels">
            {SIDEBAR_NAV.map(({ id, label, title, color }) => {
              const silhouette = id === 'inventory' && !openingTrail.isRevealed('inventory.basic');
              const active = id === 'hub'
                ? lobbyOpen && !activePanel && !inboxOpen && gameState === GAME_STATE.idle
                : id === 'tasks'
                  ? activePanel === 'tasks' || activePanel === 'queue'
                : id === 'inventory'
                  ? activePanel === id || INVENTORY_CHILD_PANELS.has(activePanel)
                  : activePanel === id;
              const nextMoveTarget = worldRouteTargetsPanel(worldRoute?.locationId, id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`hub-world-button hub-world-button--nav ${active ? 'active' : ''} ${nextMoveTarget ? 'is-next-move-target' : ''} ${silhouette ? 'is-opening-silhouette' : ''}`}
                  data-next-move-target={nextMoveTarget ? 'true' : undefined}
                  onClick={() => handleNavClick(id)}
                  title={silhouette ? `${title} · introduced after your first task-session outcome; available now` : title}
                  aria-label={silhouette ? `${title}, Opening Trail preview, available now` : title}
                  style={{ '--nav-color': color }}
                >
                  <span className="hub-nav-icon">
                    <Icon name={id} size={20} />
                  </span>
                  <span className="hub-nav-label">{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="hub-world-actions" aria-label="Utilities">
            <QuickCaptureLauncher />

            <button
              type="button"
              className={`hub-world-button hub-world-button--utility ${inboxOpen ? 'active' : ''}`}
              onClick={toggleInbox}
              title="Inbox"
              aria-label="Inbox"
            >
              <Icon name="inbox" size={20} />
              {unreadCount > 0 && (
                <span className="hub-world-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>

            {!!activeTask?.createdAt && <div className="hub-session-dot" title="Session active" />}
            <button
              type="button"
              className={`hub-world-avatar-wrap ${activePanel === 'profile' ? 'active' : ''}`}
              onClick={() => { setLobbyOpen(false); replacePanel('profile', currentPlayer?.UUID); }}
              title="Profile"
              aria-label="Profile"
            >
              <div
                className={`hub-avatar-ring rank-ring-${rankClass}`}
                style={{ boxShadow: rankGlow }}
              >
                <ResourceImage
                  value={currentPlayer?.profilePicture}
                  className="hub-world-avatar"
                  alt={currentPlayer?.username || 'Profile'}
                  loading="eager"
                  fallback={(
                    <div className="hub-world-avatar hub-world-avatar--init">
                      {currentPlayer?.username?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                />
              </div>
            </button>
          </div>
        </div>
        <Suspense fallback={<PanelLoading />}>
          {renderFocusOverlay()}
          {lobbyVisible && (
            <div
              className="hub-overlay-backdrop hub-overlay-backdrop--lobby"
              role="presentation"
              onMouseDown={() => setLobbyOpen(false)}
            >
              <div
                className="hub-lobby-menu"
                data-traversal-surface="lobby"
                role="dialog"
                aria-label="Lobby menu"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="hub-overlay-close hub-lobby-close"
                  onClick={() => setLobbyOpen(false)}
                  aria-label="Close lobby menu"
                >
                  x
                </button>
                {renderManagedPanel('lobby', true)}
              </div>
            </div>
          )}
          {activePanel && (
            <div
              className={`hub-overlay-backdrop hub-overlay-backdrop--${panelMode}`}
              role="presentation"
              onMouseDown={closePanel}
            >
              <div
                className={panelClassName}
                data-traversal-surface={panelMode || activePanel}
                role="dialog"
                aria-label={activePanel + ' panel'}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="hub-overlay-close"
                  onClick={closePanel}
                  aria-label="Close panel"
                >
                  x
                </button>
                {renderPanel()}
              </div>
            </div>
          )}
          <div className="hub-panel-parking" hidden aria-hidden="true">
            {parkedPanelIds.map((panelId) => (
              <div key={`parked:${panelId}`}>{renderManagedPanel(panelId, false)}</div>
            ))}
            {!lobbyVisible && isPanelMounted(panelLifecycleStates.lobby) && (
              <div>{renderManagedPanel('lobby', false)}</div>
            )}
            {!inboxVisible && isPanelMounted(panelLifecycleStates.inbox) && (
              <div>{renderManagedPanel('inbox', false)}</div>
            )}
          </div>
        </Suspense>
        <EdgeNextMoveHost />
      </main>

      {inboxVisible && (
        <DrawerFrame
          title="Inbox"
          subtitle={unreadCount ? `${unreadCount} unread` : 'You are caught up'}
          eyebrow="Messages"
          accent="var(--color-profile)"
          onClose={() => setInboxOpen(false)}
          className="hub-inbox-drawer"
        >
          <Suspense fallback={<PanelLoading />}>
            {renderManagedPanel('inbox', true)}
          </Suspense>
        </DrawerFrame>
      )}
      </div>
  );
}
