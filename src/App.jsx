import { useState, createContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import './App.css';
import Dashboard  from './Pages/Dashboard/Dashboard';
import Settings   from './Pages/Settings/Settings';
import Journal    from './Pages/Journal/Journal';
import Trees      from './Pages/Trees/Trees';
import AuthScreen from './Pages/Auth/AuthScreen';
import SupabaseConnection from './network/SupabaseConnection';
import { supabase } from './network/supabaseClient';
import NiceModal from '@ebay/nice-modal-react';
import OnboardingModal, { hasSeenOnboarding, markOnboardingSeen } from './Modals/OnboardingModal/OnboardingModal';

export const AppContext = createContext();

function App() {
  const nav = useNavigate();
  const db  = useMemo(() => new SupabaseConnection(), []);

  const [session,          setSession]          = useState(undefined);
  const [refreshToken,     setRefreshToken]     = useState(0);
  const [cacheReady,       setCacheReady]       = useState(false);
  const [syncing,          setSyncing]          = useState(false);
  const [isOnline,         setIsOnline]         = useState(true);
  const [player,           setPlayer]           = useState(null);
  const [todos,            setTodos]            = useState([]);
  const [journals,         setJournals]         = useState([]);
  const [allTasks,         setAllTasks]         = useState([]);
  const [lastSyncedAt,     setLastSyncedAt]     = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [accessBanner,     setAccessBanner]     = useState(false);

  // Track whether this is a brand-new sign-in (for onboarding trigger)
  const isFirstSignInRef = useRef(false);

  const prevHasAccessRef = useRef(false);

  const applySnapshot = useCallback((snapshot) => {
    const nextPlayer = snapshot?.player || null;
    if (prevHasAccessRef.current && !nextPlayer?.hasAccess) {
      setAccessBanner(true);
    }
    prevHasAccessRef.current = nextPlayer?.hasAccess ?? false;
    setTodos(snapshot?.todos            || []);
    setJournals(snapshot?.journals      || []);
    setAllTasks(snapshot?.tasks         || []);
    setPlayer(nextPlayer);
    setLastSyncedAt(snapshot?.lastSyncedAt  || null);
    setPendingSyncCount(snapshot?.pendingSyncCount || 0);
  }, []);

  const hydrateLocal = useCallback(async () => {
    const snapshot = await db.getCachedSnapshot();
    applySnapshot(snapshot);
    setCacheReady(true);
    return snapshot;
  }, [db, applySnapshot]);

  const syncRemote = useCallback(async () => {
    if (!session) return;
    const online = await db.checkConnectivity({ force: true });
    setIsOnline(online);
    if (!online) return;
    setSyncing(true);
    try {
      const snapshot = await db.syncData();
      applySnapshot(snapshot);
      setCacheReady(true);
    } finally {
      setSyncing(false);
    }
  }, [db, session, applySnapshot]);

  const refresh = useCallback((options = { syncRemote: true }) => {
    setRefreshToken(t => t + 1);
    if (options?.syncRemote === false) { hydrateLocal(); return; }
    syncRemote();
  }, [hydrateLocal, syncRemote]);

  const getTreeNodes = useCallback((treeId) =>
    todos.filter(todo => todo.treeId === treeId),
  [todos]);

  const trees = useMemo(() =>
    [...todos]
      .filter(todo => todo.isRoot)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [todos]);

  // ── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      db.setSessionUser(session?.user || null);
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      db.setSessionUser(session?.user || null);
      setSession(session);

      // Mark as first sign-in so we can show onboarding after hydration
      if (event === 'SIGNED_IN') {
        isFirstSignInRef.current = !hasSeenOnboarding();
      }

      if (!session) {
        setCacheReady(false);
        setPlayer(null);
        setTodos([]);
        setJournals([]);
        setAllTasks([]);
        setLastSyncedAt(null);
        setPendingSyncCount(0);
        setAccessBanner(false);
        prevHasAccessRef.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Trigger onboarding after first sign-in + hydration ──────────────────
  useEffect(() => {
    if (cacheReady && isFirstSignInRef.current) {
      isFirstSignInRef.current = false;
      // Small delay so the app is fully painted before showing the modal
      setTimeout(() => NiceModal.show(OnboardingModal), 600);
    }
  }, [cacheReady]);

  // ── Connectivity probe ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const runProbe = async (force = false) => {
      const online = await db.checkConnectivity({ force });
      if (!cancelled) setIsOnline(online);
    };
    const handleOnline     = () => runProbe(true);
    const handleOffline    = () => { setIsOnline(false); db._lastConnectivityResult = false; };
    const handleVisibility = () => { if (document.visibilityState === 'visible') runProbe(true); };
    const handleFocus      = () => runProbe(true);

    runProbe(true);
    window.addEventListener('online',             handleOnline);
    window.addEventListener('offline',            handleOffline);
    window.addEventListener('focus',              handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = window.setInterval(() => runProbe(true), 15000);

    return () => {
      cancelled = true;
      window.removeEventListener('online',             handleOnline);
      window.removeEventListener('offline',            handleOffline);
      window.removeEventListener('focus',              handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [db]);

  useEffect(() => {
    if (!session) return;
    hydrateLocal();
  }, [session, refreshToken, hydrateLocal]);

  useEffect(() => {
    const handleLocalChange = () => { if (session) hydrateLocal(); };
    window.addEventListener('canopy-local-data-changed', handleLocalChange);
    return () => window.removeEventListener('canopy-local-data-changed', handleLocalChange);
  }, [session, hydrateLocal]);

  useEffect(() => {
    if (session) syncRemote();
  }, [session, refreshToken, syncRemote]);

  const contextValue = useMemo(() => ({
    databaseConnection: db,
    timestamp: refreshToken,
    refresh,
    player,
    hasAccess: player?.hasAccess ?? false,
    todos,
    trees,
    getTreeNodes,
    journals,
    allTasks,
    cacheReady,
    syncing,
    isOnline,
    lastSyncedAt,
    pendingSyncCount,
  }), [
    db, refreshToken, refresh, player, todos, trees, getTreeNodes,
    journals, allTasks, cacheReady, syncing, isOnline, lastSyncedAt, pendingSyncCount,
  ]);

  if (session === undefined) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text3)', fontSize:13 }}>
        loading…
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuth={() => refresh()} />;
  }

  return (
    <>
      <nav className="nav-bar">
        <span className="nav-logo">canopy</span>
        <div className="nav-links">
          <a onClick={() => nav('/')}>Dashboard</a>
          <a onClick={() => nav('/trees')}>Trees</a>
          <a onClick={() => nav('/journal')}>Journal</a>
          <a onClick={() => nav('/settings')}>Settings</a>
        </div>
        <div className="nav-status">
          <span className={`nav-status-dot ${isOnline ? 'nav-status-dot--online' : 'nav-status-dot--offline'}`} />
          <span>{isOnline ? (syncing ? 'Syncing' : 'Online') : 'Offline'}</span>
          {pendingSyncCount > 0 && <span className="nav-status-queue">{pendingSyncCount}</span>}
          {/* Help button */}
          <button
            className="nav-help-btn"
            onClick={() => NiceModal.show(OnboardingModal)}
            title="How to use Canopy"
            aria-label="Open guide"
          >
            ?
          </button>
        </div>
      </nav>

      {accessBanner && (
        <div className="access-revoked-banner">
          <span>
            Your access key was claimed by another account — you've been moved to the free plan.
            Go to <a onClick={() => nav('/settings')}>Settings</a> to enter a new key.
          </span>
          <button className="btn-ghost access-revoked-dismiss" onClick={() => setAccessBanner(false)}>✕</button>
        </div>
      )}

      <AppContext.Provider value={contextValue}>
        <NiceModal.Provider>
          <Routes>
            <Route path='/'         element={<Dashboard />} />
            <Route path='/trees'    element={<Trees />} />
            <Route path='/journal'  element={<Journal />} />
            <Route path='/settings' element={<Settings />} />
          </Routes>
        </NiceModal.Provider>
      </AppContext.Provider>
    </>
  );
}

export default App;