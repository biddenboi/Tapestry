import { useState, createContext, useEffect, useMemo } from 'react';
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

export const AppContext = createContext();

function App() {
  const nav = useNavigate();

  const [session,   setSession]   = useState(undefined);
  const [player,    setPlayer]    = useState(null);
  const [timestamp, setTimestamp] = useState(Date.now());

  // ── Shared data cache (lifted above page level) ───────────────────────────
  const [journals,  setJournals]  = useState([]);
  const [allTasks,  setAllTasks]  = useState([]);

  const db = useMemo(() => new SupabaseConnection(), []);

  // ── Auth listener ─────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Load player when session changes ──────────────────────────────────────
  useEffect(() => {
    if (!session) { setPlayer(null); return; }
    db.getOrCreatePlayer().then(setPlayer);
  }, [session, timestamp]);

  // ── Load shared data once per session / refresh ───────────────────────────
  // Pages read from this cache; calling refresh() silently updates all consumers.
  useEffect(() => {
    if (!session) { setJournals([]); setAllTasks([]); return; }
    Promise.all([
      db.getAllJournals(),
      db.getAllTasks(),
    ]).then(([j, t]) => {
      setJournals(j);
      setAllTasks(t);
    });
  }, [session, timestamp]);

  const contextValue = useMemo(() => ({
    databaseConnection: db,
    timestamp,
    refresh: () => setTimestamp(Date.now()),
    player,
    hasAccess: player?.hasAccess ?? false,
    // Shared cached data — pages read these instead of fetching individually
    journals,
    allTasks,
  }), [db, timestamp, player, journals, allTasks]);

  if (session === undefined) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text3)', fontSize:13 }}>
        loading…
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuth={() => setTimestamp(Date.now())} />;
  }

  if (player?.blocked) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:12 }}>
        <p style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>Access revoked</p>
        <p style={{ fontSize:13, color:'var(--text2)', maxWidth:320, textAlign:'center' }}>
          Your access key was claimed by another account. Enter a new key in Settings to restore full access,
          or contact support.
        </p>
        <button onClick={() => nav('/settings')} className="btn-primary" style={{ marginTop:8 }}>Go to Settings</button>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
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
      </nav>

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
