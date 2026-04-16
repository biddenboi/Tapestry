import { useState, createContext, useEffect, useMemo, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import './App.css';
import DatabaseConnection from './network/DatabaseConnection.js';
import { SECOND, GAME_STATE, STORES } from './utils/Constants.js';
import { useInterval } from './utils/useInterval.js';
import NiceModal from '@ebay/nice-modal-react';
import GameHub from './components/GameHub/GameHub.jsx';
import NotificationCenter from './components/NotificationCenter/NotificationCenter.jsx';

export const AppContext = createContext();

function App() {
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [activeTask, setActiveTask] = useState({});
  const [gameState, setGameState] = useState(GAME_STATE.idle);
  const [activeMatch, setActiveMatch] = useState(null);
  const [activePanel, setActivePanel] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);

  const databaseConnection = useMemo(() => new DatabaseConnection(), []);

  const refreshApp = useCallback(() => {
    setTimestamp(Date.now());
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts((existing) => existing.filter((toast) => toast.id !== toastId));
  }, []);

  const notify = useCallback(async ({ title, message, kind = 'info', persist = true }) => {
    const id = uuid();
    setToasts((existing) => [...existing, { id, title, message, kind }]);
    window.setTimeout(() => dismissToast(id), 4500);

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
  }, [currentPlayer, databaseConnection, dismissToast, refreshApp]);

  useEffect(() => {
    const load = async () => {
      const player = await databaseConnection.getCurrentPlayer();
      setCurrentPlayer(player || null);

      if (player?.UUID && typeof databaseConnection.getNotificationsForPlayer === 'function') {
        const playerNotifications = await databaseConnection.getNotificationsForPlayer(player.UUID);
        playerNotifications.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setNotifications(playerNotifications);
      } else {
        setNotifications([]);
      }
    };

    load();
  }, [databaseConnection, timestamp]);

  useInterval(() => setTimestamp(Date.now()), SECOND * 10);

  const openPanel = (panel, profileUUID = null) => {
    setActivePanel(panel);
    if (profileUUID) setViewingProfile(profileUUID);
  };

  const closePanel = () => {
    setActivePanel(null);
    setViewingProfile(null);
  };

  const contextValue = useMemo(() => ({
    databaseConnection,
    timestamp,
    refreshApp,
    notify,
    notifications,
    currentPlayer,
    activeTask: [activeTask, setActiveTask],
    gameState: [gameState, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
    activePanel: [activePanel, setActivePanel],
    viewingProfile: [viewingProfile, setViewingProfile],
    openPanel,
    closePanel,
  }), [databaseConnection, timestamp, refreshApp, notify, notifications, currentPlayer, activeTask, gameState, activeMatch, activePanel, viewingProfile]);

  return (
    <AppContext.Provider value={contextValue}>
      <NiceModal.Provider>
        <GameHub />
        <NotificationCenter toasts={toasts} onDismiss={dismissToast} />
      </NiceModal.Provider>
    </AppContext.Provider>
  );
}

export default App;
