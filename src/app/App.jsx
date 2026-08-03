import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import '@app/App.css';
import DatabaseConnection from '@data/DatabaseConnection.js';
import SqliteStorageAdapter from '@data/persistence/sqlite/SqliteStorageAdapter.js';
import { MINUTE, GAME_STATE, STORES } from '@domain/constants.js';
import {
  applyThemeToElement,
  DEFAULT_THEME_ID,
  getRecentThemeCommitForPlayer,
  resolveThemeId,
} from '@domain/themes/ThemeRegistry.js';
import { applyCosmeticEquipmentToElement } from '@domain/cosmetics/CosmeticCatalog.js';
import { useInterval } from '@shared/hooks/useInterval.js';
import NiceModal from '@ebay/nice-modal-react';
import GameHub from '@app/shell/GameHub/GameHub.jsx';
import DataSourceGate from '@app/data-source/DataSourceGate/DataSourceGate.jsx';
import MobileAppShell from '@app/mobile/MobileAppShell.jsx';
import { useMobileCompanion } from '@app/mobile/useMobileCompanion.js';
import { AppContext } from '@app/context/AppContext.js';
import {
  DATA_DOMAINS,
  DOMAIN_INVALIDATION,
  bumpDomainRevisions,
  createDomainRevisions,
} from '@app/context/domainRevisions.js';
import RewardFloatLayer from '@app/rewards/RewardFloatLayer.jsx';
import { createPlayerRewardEvents, playerRewardEventRemovalDelay } from '@app/rewards/playerRewardEvents.js';
import { useCurrentPlayerSession } from '@app/hooks/useCurrentPlayerSession.js';
import { useSocialWorldPresenceLifecycle } from '@features/social-world/hooks/useSocialWorldPresenceLifecycle.js';
import TaskSessionProvider from '@features/tasks/context/TaskSessionProvider.jsx';
import {
  installSoundEffectUnlock,
  playAppSound,
  soundForRewardItems,
} from '@shared/audio/AppSounds.js';
import {
  markPanelOpenRequested,
  markStartup,
  registerStaticModule,
} from '@shared/performance/startupPerf.js';
import {
  createPanelNavigationFrame,
  popPanelNavigationFrame,
  pushPanelNavigationFrame,
} from '@shared/navigation/PanelNavigationFrames.js';
import { refreshDueAppBadge } from '@shared/runtime/DueStateRuntime.js';
import { installInstanceHandoffResponder } from '@shared/runtime/InstanceHandoff.js';
import InstanceStandbyGate from '@app/instance/InstanceStandbyGate.jsx';

registerStaticModule('app/App');

const MobileCloudBootstrapGate = lazy(() => import('@app/mobile/MobileCloudBootstrapGate.jsx'));

function resolvePresentedAppTheme(themeId) {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const visualQaTheme = new URLSearchParams(window.location.search).get('themePreview');
    if (visualQaTheme) return resolveThemeId(visualQaTheme);
  }
  return resolveThemeId(themeId || DEFAULT_THEME_ID);
}

const INVENTORY_ONLY_PANELS = new Set(['shop', 'pass']);
let applicationDatabaseConnection = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    applicationDatabaseConnection?.syncRuntime?.stop?.();
    applicationDatabaseConnection?.persistenceRuntime?.sqliteStorageAdapter?.client?.terminate?.();
    applicationDatabaseConnection = null;
  });
}

function createApplicationDatabaseConnection() {
  if (applicationDatabaseConnection) return applicationDatabaseConnection;
  const sqliteStorageAdapter = new SqliteStorageAdapter();
  const databaseConnection = new DatabaseConnection({ sqliteStorageAdapter });
  const databaseReady = databaseConnection.ready;
  const ephemeralDevelopmentDatabase = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('ephemeral') === '1';
  databaseConnection.ready = Promise.all([
    databaseReady,
    sqliteStorageAdapter.open({
      mode: ephemeralDevelopmentDatabase ? 'memory' : 'persistent',
      writerLeaseWaitMs: ephemeralDevelopmentDatabase ? 0 : 8_000,
      writerLeasePollMs: 120,
    }),
  ])
    .then(([, openResult]) => {
      if (!openResult?.initialization?.initialized) {
        const error = new Error('Tapestry storage is already open in another tab. Close the other tab, then try again.');
        error.code = 'sqlite-writer-lease-unavailable';
        throw error;
      }
      return databaseConnection.initializeCompactSqlite();
    })
    .then(() => undefined);
  // Road backfill reads through the public facade, whose methods await
  // databaseConnection.ready. Starting it inside initializeCompactSqlite()
  // creates a circular startup wait. Keep it explicitly post-ready and
  // non-blocking so the shell can open even if a reconciliation record needs
  // repair after an interrupted import.
  databaseConnection.contributionRoadReady = databaseConnection.ready
    .then(() => databaseConnection.contributionRoad.reconcile())
    .catch((error) => {
      console.warn('[Tapestry] Contribution Road reconciliation will retry when the Road opens.', error);
      return { reconciled: 0, error };
    });
  applicationDatabaseConnection = databaseConnection;
  return databaseConnection;
}

function App() {
  const mobileCompanion = useMobileCompanion();
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [currentPlayerLoaded, setCurrentPlayerLoaded] = useState(false);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [dataRevision, setDataRevision] = useState(0);
  const [domainRevisions, setDomainRevisions] = useState(createDomainRevisions);
  const [activeTask, setActiveTask] = useState({});
  const [gameState, setGameState] = useState(GAME_STATE.idle);
  const [activeMatch, setActiveMatch] = useState(null);
  const [activePanel, setActivePanel] = useState(null);
  const [activeSubview, setActiveSubview] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [routeIntent, setRouteIntent] = useState(null);
  const [worldRoute, setWorldRoute] = useState(null);
  const [rewardEvents, setRewardEvents] = useState([]);
  const [dataSourceReady, setDataSourceReady] = useState(false);
  const [instanceStandby, setInstanceStandby] = useState(false);

  // Dojo session UUID — minted fresh whenever the player enters the dojo,
  // cleared on exit. Mirrors how match.UUID is generated when COMPETE is
  // pressed in Lobby.handleFindMatch — so dojo "sessions" become indexable
  // first-class objects, the same as matches. Tasks completed while in dojo
  // stamp this UUID onto the task record, and PracticeDojo's session-points
  // view + top-sessions leaderboard both group by it.
  const [dojoSessionUUID, setDojoSessionUUID] = useState(null);

  const databaseConnection = useMemo(createApplicationDatabaseConnection, []);
  const taskSoundActiveRef = useRef(false);
  const gameStateSoundInitializedRef = useRef(false);
  const previousGameStateRef = useRef(gameState);
  const startupInitializedRef = useRef(false);
  const refreshFrameRef = useRef(null);
  const taskCompletionRecoveryRef = useRef(null);
  const achievementRecoveryRef = useRef(null);
  const themeWriteOverrideRef = useRef(null);
  const navigationFramesRef = useRef([]);
  const activeNavigationFrameRef = useRef(createPanelNavigationFrame());

  if (!startupInitializedRef.current) {
    startupInitializedRef.current = true;
    markStartup('app-rendered');
  }

  useEffect(() => {
    markStartup('app-mounted');
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(databaseConnection.ready)
      .then(() => import('@data/sync/supabase/SupabaseSyncBootstrap.js'))
      .then(({ initializeSupabaseSync }) => (
        cancelled ? null : initializeSupabaseSync(databaseConnection)
      ))
      .catch((error) => {
        if (!cancelled) {
          console.warn('[Tapestry] Private sync is unavailable; local data remains active.', error);
        }
      });
    return () => { cancelled = true; };
  }, [databaseConnection]);

  useEffect(() => {
    let dispose = () => undefined;
    let cancelled = false;
    Promise.resolve(databaseConnection.ready)
      .then(() => {
        if (cancelled) return;
        dispose = installInstanceHandoffResponder({
          onStandby: () => setInstanceStandby(true),
          release: async () => {
            await databaseConnection.flushWrites?.();
            const synchronize = databaseConnection.syncRuntime?.synchronize?.({
              reason: 'instance-handoff',
            });
            if (synchronize) {
              await Promise.race([
                Promise.resolve(synchronize).catch(() => undefined),
                new Promise((resolve) => window.setTimeout(resolve, 8_000)),
              ]);
            }
            databaseConnection.syncRuntime?.stop?.();
            await databaseConnection.persistenceRuntime.sqliteStorageAdapter.close({ markClean: true });
          },
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      dispose();
    };
  }, [databaseConnection]);

  useEffect(() => {
    const bridge = typeof window === 'undefined' ? null : window.tapestryDesktopBackups;
    if (!bridge?.getConfig) return undefined;
    let cancelled = false;
    let running = false;
    const checkScheduledBackup = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const config = await bridge.getConfig();
        const lastRun = config?.lastRunAt ? new Date(config.lastRunAt).getTime() : 0;
        const intervalMs = Math.max(1, Number(config?.intervalHours || 24)) * 60 * 60 * 1000;
        if (config?.enabled && config.directory && Date.now() - lastRun >= intervalMs) {
          await databaseConnection.ready;
          await databaseConnection.createEncryptedDesktopBackup();
        }
      } catch (error) {
        console.warn('[Tapestry] Scheduled encrypted backup will retry later.', error);
      } finally {
        running = false;
      }
    };
    void checkScheduledBackup();
    const timer = window.setInterval(checkScheduledBackup, 15 * MINUTE);
    window.addEventListener('focus', checkScheduledBackup);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', checkScheduledBackup);
    };
  }, [databaseConnection]);

  useEffect(() => {
    if (!currentPlayer?.UUID) return undefined;
    let cancelled = false;
    const refreshBadge = () => {
      if (cancelled) return;
      void Promise.resolve(databaseConnection.ready)
        .then(() => refreshDueAppBadge(databaseConnection, currentPlayer.UUID))
        .catch(() => undefined);
    };
    refreshBadge();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshBadge();
    };
    window.addEventListener('focus', refreshBadge);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshBadge);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [currentPlayer?.UUID, databaseConnection, timestamp]);

  const refreshApp = useCallback(() => {
    if (typeof window === 'undefined') {
      setTimestamp(Date.now());
      setDataRevision((revision) => revision + 1);
      setDomainRevisions((revisions) => bumpDomainRevisions(revisions, DATA_DOMAINS));
      return;
    }
    if (refreshFrameRef.current != null) return;
    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null;
      setTimestamp(Date.now());
      setDataRevision((revision) => revision + 1);
      setDomainRevisions((revisions) => bumpDomainRevisions(revisions, DATA_DOMAINS));
    });
  }, []);

  const invalidateDomains = useCallback((...domains) => {
    setTimestamp(Date.now());
    setDomainRevisions((revisions) => bumpDomainRevisions(revisions, domains));
  }, []);

  const recoverTaskCompletions = useCallback(() => {
    if (taskCompletionRecoveryRef.current) return taskCompletionRecoveryRef.current;
    const recovery = import('@features/tasks/domain/TaskCompletionProcessors.js')
      .then(({ recoverPendingTaskCompletionProcessing }) => (
        recoverPendingTaskCompletionProcessing(databaseConnection)
      ))
      .catch((error) => {
        console.warn('[App] task completion recovery failed:', error);
      })
      .finally(() => {
        if (taskCompletionRecoveryRef.current === recovery) taskCompletionRecoveryRef.current = null;
      });
    taskCompletionRecoveryRef.current = recovery;
    return recovery;
  }, [databaseConnection]);

  const recoverAchievements = useCallback(() => {
    if (achievementRecoveryRef.current) return achievementRecoveryRef.current;
    const recovery = import('@domain/achievements/AchievementProcessing.js')
      .then(({ recoverPendingAchievementEvents }) => (
        recoverPendingAchievementEvents(databaseConnection)
      ))
      .catch((error) => {
        console.warn('[App] achievement recovery failed:', error);
      })
      .finally(() => {
        if (achievementRecoveryRef.current === recovery) achievementRecoveryRef.current = null;
      });
    achievementRecoveryRef.current = recovery;
    return recovery;
  }, [databaseConnection]);

  useEffect(() => {
    const onSyncComplete = () => {
      invalidateDomains(...DATA_DOMAINS);
      // A recovery pass may already be reading the pre-sync event list. Queue
      // one more idempotent pass after it so a phone completion always reaches
      // desktop contribution, achievement, and stat projections.
      void Promise.resolve(recoverTaskCompletions()).then(() => recoverTaskCompletions());
      void Promise.resolve(recoverAchievements()).then(() => recoverAchievements());
    };
    window.addEventListener('tapestry:sync-complete', onSyncComplete);
    return () => window.removeEventListener('tapestry:sync-complete', onSyncComplete);
  }, [invalidateDomains, recoverAchievements, recoverTaskCompletions]);

  const ensureDomainLoaded = useCallback(async (domains) => {
    const requested = Array.isArray(domains) ? domains.flat(Infinity) : [domains];
    const pending = requested.filter((domain) => (
      domain && !databaseConnection.isDomainLoaded?.(domain)
    ));
    if (!pending.length) {
      if (requested.includes('tasks')) void recoverTaskCompletions();
      if (requested.includes('achievements')) void recoverAchievements();
      return {
        domains: requested.filter(Boolean),
        partial: databaseConnection.isPartiallyLoaded?.() || false,
      };
    }

    markStartup('domain-hydration-start', { domains: pending });
    const result = await databaseConnection.ensureDomainsLoaded(pending);
    const revisionDomains = (result.loadedDomains || result.domains)
      .filter((domain) => DATA_DOMAINS.includes(domain));
    if (revisionDomains.length) {
      setDomainRevisions((revisions) => bumpDomainRevisions(revisions, revisionDomains));
    }
    markStartup('domain-hydration-done', {
      domains: result.domains,
      partial: !!result.partial,
    });
    if (requested.includes('tasks')) void recoverTaskCompletions();
    if (requested.includes('achievements')) void recoverAchievements();
    return result;
  }, [databaseConnection, recoverAchievements, recoverTaskCompletions]);

  const isDomainLoaded = useCallback(
    (domain) => databaseConnection.isDomainLoaded?.(domain) !== false,
    [databaseConnection],
  );

  useEffect(() => () => {
    if (refreshFrameRef.current != null) window.cancelAnimationFrame(refreshFrameRef.current);
  }, []);

  const playSound = useCallback((soundName, options = {}) => {
    playAppSound(soundName, options);
  }, []);

  const handleDataSourceReady = useCallback(() => {
    markStartup('data-source-ready');
    setDataSourceReady(true);
  }, []);

  const updateCurrentPlayer = useCallback((nextPlayer) => {
    const applyPlayerPresentation = (player) => {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      root.toggleAttribute('data-reduced-motion', player?.reducedMotion === true);
      root.toggleAttribute('data-high-contrast', player?.highContrast === true);
      root.toggleAttribute('data-large-mobile-text', player?.largeMobileText === true);
      applyCosmeticEquipmentToElement(root, player?.activeCosmetics);
      const equippedTheme = player?.activeCosmetics?.appTheme || player?.activeCosmetics?.theme;
      if (!equippedTheme) return;
      themeWriteOverrideRef.current = {
        playerUUID: player.UUID || null,
        themeId: resolvePresentedAppTheme(equippedTheme),
        writtenAt: Date.now(),
      };
      applyThemeToElement(root, resolvePresentedAppTheme(equippedTheme));
    };
    if (typeof nextPlayer === 'function') {
      setCurrentPlayer((current) => {
        const resolved = nextPlayer(current);
        applyPlayerPresentation(resolved);
        return resolved;
      });
      return;
    }
    applyPlayerPresentation(nextPlayer);
    setCurrentPlayer(nextPlayer || null);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.toggleAttribute('data-reduced-motion', currentPlayer?.reducedMotion === true);
    root.toggleAttribute('data-high-contrast', currentPlayer?.highContrast === true);
    root.toggleAttribute('data-large-mobile-text', currentPlayer?.largeMobileText === true);
    applyCosmeticEquipmentToElement(root, currentPlayer?.activeCosmetics);
    if (root.hasAttribute('data-theme-preview')) return;
    const committedThemeId = getRecentThemeCommitForPlayer(root, currentPlayer?.UUID);
    if (committedThemeId) {
      applyThemeToElement(root, committedThemeId);
      return;
    }
    const override = themeWriteOverrideRef.current;
    const hasFreshOverride = override
      && override.playerUUID === (currentPlayer?.UUID || null)
      && Date.now() - override.writtenAt < 5000;
    applyThemeToElement(
      root,
      hasFreshOverride
        ? override.themeId
        : resolvePresentedAppTheme(currentPlayer?.activeCosmetics?.appTheme || currentPlayer?.activeCosmetics?.theme),
    );
  }, [
    currentPlayer?.UUID,
    currentPlayer?.activeCosmetics?.appTheme,
    currentPlayer?.activeCosmetics?.theme,
    currentPlayer?.activeCosmetics?.navigationSkin,
    currentPlayer?.activeCosmetics?.workspaceBackdrop,
    currentPlayer?.activeCosmetics?.motionEffect,
    currentPlayer?.reducedMotion,
    currentPlayer?.highContrast,
    currentPlayer?.largeMobileText,
  ]);

  useEffect(() => installSoundEffectUnlock(), []);

  const emitRewardEvent = useCallback((items = [], options = {}) => {
    const gains = createPlayerRewardEvents(items, options);
    if (!gains.length) return;
    const soundName = soundForRewardItems(items, options);
    if (soundName) playSound(soundName, { volume: options.soundVolume ?? 1 });
    const gainIds = new Set(gains.map((gain) => gain.id));
    setRewardEvents((existing) => [...existing, ...gains].slice(-24));
    window.setTimeout(() => {
      setRewardEvents((existing) => existing.filter((gain) => !gainIds.has(gain.id)));
    }, playerRewardEventRemovalDelay(gains.length));
  }, [playSound]);

  const notify = useCallback(async ({ title, message, kind = 'info', persist = true }) => {
    if (persist && currentPlayer?.UUID) {
      await databaseConnection.add(STORES.notification, {
        UUID: uuid(),
        parent: currentPlayer.UUID,
        title,
        message,
        kind,
        createdAt: new Date().toISOString(),
        readAt: null,
      });
      refreshApp();
    }
  }, [currentPlayer, databaseConnection, refreshApp]);

  const commitCurrentProfile = useCallback(async (nextPlayerOrUpdater) => {
    const previous = currentPlayer?.UUID
      ? currentPlayer
      : await databaseConnection.getCurrentPlayer();
    if (!previous?.UUID) throw new Error('No current profile is available.');
    const next = typeof nextPlayerOrUpdater === 'function'
      ? nextPlayerOrUpdater(previous)
      : nextPlayerOrUpdater;
    if (!next || String(next.UUID || '') !== String(previous.UUID)) {
      throw new Error('A current-profile update must preserve the active profile identity.');
    }
    try {
      await databaseConnection.add(STORES.player, next);
    } catch (error) {
      notify?.({
        title: 'Profile not saved',
        message: error?.message || 'Your previous profile identity is still active.',
        kind: 'error',
        persist: false,
      });
      throw error;
    }
    updateCurrentPlayer(next);
    invalidateDomains(DOMAIN_INVALIDATION.profileWrite);
    return next;
  }, [currentPlayer, databaseConnection, invalidateDomains, notify, updateCurrentPlayer]);

  useCurrentPlayerSession({
    databaseConnection,
    profileRevision: domainRevisions.profiles,
    matchesRevision: domainRevisions.matches,
    dataSourceReady,
    setCurrentPlayer,
    setCurrentPlayerLoaded,
  });

  useInterval(() => setTimestamp(Date.now()), gameState === GAME_STATE.match ? null : MINUTE);

  useSocialWorldPresenceLifecycle({
    databaseConnection,
    dataSourceReady,
    currentPlayer,
    timestamp,
    gameState,
    activeTask,
    activeMatch,
    dojoSessionUUID,
    activePanel,
    invalidateDomains,
  });

  // Mint a fresh dojoSessionUUID on entry to dojo, clear it on exit.
  // The (prev || uuid()) guard means the same session UUID is preserved if
  // gameState briefly re-enters dojo within the same session — but in normal
  // flow this just runs once per dojo entry.
  useEffect(() => {
    if (gameState === GAME_STATE.dojo) {
      setDojoSessionUUID((prev) => prev || uuid());
    } else {
      setDojoSessionUUID(null);
    }
  }, [gameState]);

  useEffect(() => {
    const taskActive = !!activeTask?.createdAt;
    if (taskActive && !taskSoundActiveRef.current) playSound('timer-start', { volume: 0.85 });
    taskSoundActiveRef.current = taskActive;
  }, [activeTask?.createdAt, playSound]);

  useEffect(() => {
    if (!gameStateSoundInitializedRef.current) {
      gameStateSoundInitializedRef.current = true;
      previousGameStateRef.current = gameState;
      return;
    }
    const previous = previousGameStateRef.current;
    if (previous === gameState) return;
    if (gameState === GAME_STATE.match) {
      const createdAt = activeMatch?.createdAt ? new Date(activeMatch.createdAt).getTime() : Date.now();
      if (Date.now() - createdAt < 12000) playSound('match-start', { volume: 1.08, throttleMs: 400 });
    } else if (gameState === GAME_STATE.dojo) {
      playSound('dojo-start', { volume: 0.95, throttleMs: 400 });
    }
    previousGameStateRef.current = gameState;
  }, [activeMatch?.createdAt, gameState, playSound]);

  const applyNavigationFrame = useCallback((frame, { announceOpen = true } = {}) => {
    const normalized = createPanelNavigationFrame(frame || {}, currentPlayer?.UUID || null);
    const previous = activeNavigationFrameRef.current;
    if (announceOpen && normalized.panel && normalized.panel !== previous?.panel) {
      markPanelOpenRequested(normalized.panel);
      playSound('panel-open', { volume: 0.78 });
    }
    activeNavigationFrameRef.current = normalized;
    setActivePanel(normalized.panel);
    setActiveSubview(normalized.subview);
    setViewingProfile(normalized.panel === 'profile'
      ? normalized.entityUUID || normalized.profileUUID || currentPlayer?.UUID || null
      : null);
    const intent = normalized.panel ? {
      ...normalized,
      intentId: normalized.intentId || uuid(),
      requestedAt: new Date().toISOString(),
    } : null;
    setRouteIntent(intent);
    return intent;
  }, [currentPlayer?.UUID, playSound]);

  const openRoute = useCallback((route = {}) => {
    const destination = createPanelNavigationFrame(route, currentPlayer?.UUID || null);
    navigationFramesRef.current = pushPanelNavigationFrame(
      navigationFramesRef.current,
      activeNavigationFrameRef.current,
      destination,
    );
    return applyNavigationFrame(destination);
  }, [applyNavigationFrame, currentPlayer?.UUID]);

  const replaceRoute = useCallback((route = {}) => {
    navigationFramesRef.current = [];
    return applyNavigationFrame(
      createPanelNavigationFrame(route, currentPlayer?.UUID || null),
    );
  }, [applyNavigationFrame, currentPlayer?.UUID]);

  const openPanel = useCallback((panel, profileUUID = null) => openRoute({
    panel,
    ...(panel === 'profile'
      ? { entityType: 'profile', entityUUID: profileUUID || currentPlayer?.UUID || null }
      : {}),
    routeLabel: panel,
  }), [currentPlayer?.UUID, openRoute]);

  const replacePanel = useCallback((panel, profileUUID = null) => replaceRoute({
    panel,
    ...(panel === 'profile'
      ? { entityType: 'profile', entityUUID: profileUUID || currentPlayer?.UUID || null }
      : {}),
    routeLabel: panel,
  }), [currentPlayer?.UUID, replaceRoute]);

  const consumeRouteIntent = useCallback((intentId) => {
    setRouteIntent((current) => (
      current?.intentId && current.intentId === intentId ? null : current
    ));
  }, []);

  const openInventoryPanel = useCallback((panel) => openRoute({
    panel: INVENTORY_ONLY_PANELS.has(panel) ? panel : 'inventory',
    routeLabel: panel,
  }), [openRoute]);

  const reportLocalSubpage = useCallback((panel, subview) => {
    const current = activeNavigationFrameRef.current;
    if (!current?.panel || String(current.panel) !== String(panel)) return;
    const next = { ...current, subview: subview || null };
    activeNavigationFrameRef.current = next;
    setActiveSubview(next.subview);
  }, []);

  const closePanel = useCallback(() => {
    if (activeNavigationFrameRef.current?.panel) playSound('panel-close', { volume: 0.72 });
    const popped = popPanelNavigationFrame(navigationFramesRef.current);
    navigationFramesRef.current = popped.history;
    applyNavigationFrame(popped.frame || createPanelNavigationFrame(), { announceOpen: false });
  }, [applyNavigationFrame, playSound]);

  const contextValue = useMemo(() => ({
    databaseConnection,
    timestamp,
    dataRevision,
    domainRevisions,
    invalidateDomains,
    ensureDomainLoaded,
    isDomainLoaded,
    refreshApp,
    notify,
    emitRewardEvent,
    playSound,
    currentPlayer,
    updateCurrentPlayer,
    commitCurrentProfile,
    currentPlayerLoaded,
    activeTask: [activeTask, setActiveTask],
    gameState: [gameState, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
    activePanel: [activePanel],
    viewingProfile: [viewingProfile, setViewingProfile],
    routeIntent,
    consumeRouteIntent,
    activeSubview,
    reportLocalSubpage,
    worldRoute,
    setWorldRoute,
    dojoSessionUUID,
    openRoute,
    replaceRoute,
    openPanel,
    replacePanel,
    openInventoryPanel,
    closePanel,
  }), [databaseConnection, timestamp, dataRevision, domainRevisions, invalidateDomains, ensureDomainLoaded, isDomainLoaded, refreshApp, notify, emitRewardEvent, playSound, currentPlayer, updateCurrentPlayer, commitCurrentProfile, currentPlayerLoaded, activeTask, gameState, activeMatch, activePanel, activeSubview, viewingProfile, routeIntent, consumeRouteIntent, reportLocalSubpage, worldRoute, dojoSessionUUID, openRoute, replaceRoute, openPanel, replacePanel, openInventoryPanel, closePanel]);

  return (
    <AppContext.Provider value={contextValue}>
      <TaskSessionProvider>
        <NiceModal.Provider>
          {instanceStandby ? (
            <InstanceStandbyGate />
          ) : dataSourceReady ? (
            mobileCompanion ? <MobileAppShell /> : <GameHub />
          ) : mobileCompanion ? (
            <Suspense fallback={<div className="data-source-gate-shell" aria-label="Opening private mobile setup" />}>
              <MobileCloudBootstrapGate onReady={handleDataSourceReady} />
            </Suspense>
          ) : (
            <DataSourceGate onReady={handleDataSourceReady} />
          )}
          <RewardFloatLayer gains={rewardEvents} />
        </NiceModal.Provider>
      </TaskSessionProvider>
    </AppContext.Provider>
  );
}

export default App;
