import { useContext, useEffect, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { EVENT, GAME_STATE, STORES } from '../../utils/Constants.js';
import { getMidnightOfDate, getLocalDate } from '../../utils/Helpers/Time.js';
import { endDay, startDay, getSleepDateToday } from '../../utils/Helpers/Events.js';
import { getRankClass, getRankGlow } from '../../utils/Helpers/Rank.js';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup.jsx';
import ProfileSwitcher from '../../Modals/ProfileSwitcher/ProfileSwitcher.jsx';
import Purgatory from '../../Modals/Purgatory/Purgatory.jsx';
import Lobby from '../Lobby/Lobby.jsx';
import MatchArena from '../MatchArena/MatchArena.jsx';
import PracticeDojo from '../PracticeDojo/PracticeDojo.jsx';
import TodoList from '../TodoList/TodoList.jsx';
import Shop from '../../Pages/Shop/Shop.jsx';
import Inventory from '../../Pages/Inventory/Inventory.jsx';
import Settings from '../../Pages/Settings/Settings.jsx';
import Profile from '../../Pages/Profile/Profile.jsx';
import Inbox from '../Inbox/Inbox.jsx';
import GlobalChat from '../GlobalChat/GlobalChat.jsx';
import './GameHub.css';
import BreachArena from '../../modes/breach/BreachArena.jsx';


const NAV = [
  { id: 'hub',       label: 'HUB',  icon: '◎', title: 'Lobby' },
  { id: 'tasks',     label: 'TASK', icon: '☑', title: 'Task List' },
  { id: 'chat',      label: 'CHAT', icon: '◈', title: 'Global Chat' },
  { id: 'shop',      label: 'SHOP', icon: '⬡', title: 'Shop' },
  { id: 'inventory', label: 'INV',  icon: '▤', title: 'Inventory' },
  { id: 'journal',   label: 'LOG',  icon: '✎', title: 'Journal' },
  { id: 'profile',   label: 'PRF',  icon: '◯', title: 'Profile' },
  { id: 'settings',  label: 'CFG',  icon: '✦', title: 'Settings' },
];

function forceCloseJournal() {
  document.dispatchEvent(new CustomEvent('force-close-journal'));
}

export default function GameHub() {
  const {
    databaseConnection,
    timestamp,
    currentPlayer,
    notify,
    activeTask: [activeTask],
    gameState: [gameState],
    activeMatch: [activeMatch],       
    activePanel: [activePanel],
    viewingProfile: [viewingProfile],
    openPanel,
    closePanel,
  } = useContext(AppContext);

  const sleepCheckFiredRef = useRef(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  /* Apply active cosmetics (theme + font) from context player */
  useEffect(() => {
    const theme = currentPlayer?.activeCosmetics?.theme || 'default';
    const font  = currentPlayer?.activeCosmetics?.font  || 'default';
    document.documentElement.setAttribute('data-theme', theme === 'default' ? '' : theme);
    document.documentElement.setAttribute('data-font',  font  === 'default' ? '' : font);
  }, [currentPlayer]);

  /* Poll unread inbox count */
  useEffect(() => {
    if (!currentPlayer?.UUID) { setUnreadCount(0); return; }
    databaseConnection.getUnreadFriendRequestCount(currentPlayer.UUID)
      .then(setUnreadCount)
      .catch(() => setUnreadCount(0));
  }, [databaseConnection, currentPlayer, timestamp]);

  useEffect(() => {
    let running = false;
    const syncDay = async () => {
      if (running) return;
      running = true;
      try {
        const player = await databaseConnection.getCurrentPlayer();
        if (!player?.createdAt) return;

        const lastEvent = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
        const midnight  = getMidnightOfDate(getLocalDate(new Date()));

        if (!lastEvent) {
          await startDay(databaseConnection, player);
          return;
        }

        if (getLocalDate(new Date(lastEvent.createdAt)) < midnight) {
          if (lastEvent.type === EVENT.sleep) {
            sleepCheckFiredRef.current = false;
            await startDay(databaseConnection, player);
          } else {
            await endDay(databaseConnection, player, true);
            await startDay(databaseConnection, player);
          }
          return;
        }

        /* Current day: check if sleep time has passed */
        if (lastEvent.type !== EVENT.sleep && !sleepCheckFiredRef.current) {
          const sleepDate = getSleepDateToday(player.sleepTime);
          if (sleepDate && Date.now() >= sleepDate.getTime()) {
            sleepCheckFiredRef.current = true;
            await endDay(databaseConnection, player, true);
            notify({
              title: '💀 Sleep Time Passed',
              message: 'You missed your scheduled bedtime. All tokens have been forfeited.',
              kind: 'error',
              persist: true,
            });
            NiceModal.show(ProfileSwitcher);
            return;
          }
        }

        if (lastEvent.type === EVENT.sleep) {
          NiceModal.show(ProfileSwitcher);
        }
      } finally {
        running = false;
      }
    };
    syncDay();
  }, [databaseConnection, timestamp, notify]);

  const handleNavClick = (id) => {
    if (id !== 'journal') forceCloseJournal();
    setInboxOpen(false);
    if (id === 'hub') { closePanel(); return; }
    if (id === 'journal') { closePanel(); NiceModal.show(JournalPopup); return; }
    if (activePanel === id) { closePanel(); return; }
    openPanel(id);
  };

  const toggleInbox = () => {
    setInboxOpen((v) => !v);
    if (activePanel) closePanel();
  };

  const renderMain = () => {
    if (gameState === GAME_STATE.match) {
      return activeMatch?.mode === 'breach' ? <BreachArena /> : <MatchArena />;
    }
    if (gameState === GAME_STATE.dojo) return <PracticeDojo />;
    return <Lobby />;
  };

  const renderPanel = () => {
    if (!activePanel) return null;
    const isFull = activePanel === 'shop' || activePanel === 'profile';
    let content = null;
    if (activePanel === 'tasks')     content = <TodoList />;
    if (activePanel === 'chat')      content = <GlobalChat />;
    if (activePanel === 'shop')      content = <Shop />;
    if (activePanel === 'inventory') content = <Inventory />;
    if (activePanel === 'settings')  content = <Settings />;
    if (activePanel === 'profile')   content = <Profile uuid={viewingProfile || currentPlayer?.UUID} />;
    if (!content) return null;

    return (
      <div className={`hub-panel open ${isFull ? 'hub-panel--full' : ''}`} key={activePanel}>
        <button className="hub-panel-close" onClick={closePanel} title="Close">✕</button>
        <div className="hub-panel-content">{content}</div>
      </div>
    );
  };

  const rankGlow = getRankGlow(currentPlayer?.elo || 0, 14);
  const rankClass = getRankClass(currentPlayer?.elo || 0);

  return (
    <div className={`game-hub ${activeTask?.createdAt ? 'hub-in-session' : ''}`}>
      <aside className="hub-sidebar">
        <div className="hub-logo">
          <span className="hub-logo-letter">T</span>
          <div className="hub-logo-corner" />
        </div>

        <nav className="hub-nav">
          {NAV.map(({ id, label, icon, title }) => {
            const active = id === 'hub' ? !activePanel && !inboxOpen : activePanel === id;
            return (
              <button
                key={id}
                className={`hub-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleNavClick(id)}
                title={title}
              >
                <span className="hub-nav-icon">{icon}</span>
                <span className="hub-nav-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hub-sidebar-bottom">
          {/* Inbox bell */}
          <button
            className={`hub-inbox-btn ${inboxOpen ? 'active' : ''}`}
            onClick={toggleInbox}
            title="Inbox"
          >
            <span className="hub-inbox-icon">✉</span>
            {unreadCount > 0 && (
              <span className="hub-inbox-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>

          {!!activeTask?.createdAt && <div className="hub-session-dot" title="Session active" />}
          <button
            className="hub-sidebar-avatar-wrap"
            onClick={() => openPanel('profile')}
            title="Profile"
          >
            <div
              className={`hub-avatar-ring rank-ring-${rankClass}`}
              style={{ boxShadow: rankGlow }}
            >
              {currentPlayer?.profilePicture ? (
                <img
                  src={currentPlayer.profilePicture}
                  className="hub-sidebar-avatar"
                  alt={currentPlayer?.username || 'Profile'}
                />
              ) : (
                <div className="hub-sidebar-avatar hub-sidebar-avatar--init">
                  {currentPlayer?.username?.[0]?.toUpperCase() || '?'}
                </div>
              )}
            </div>
          </button>
        </div>
      </aside>

      <main className="hub-main">{renderMain()}</main>

      {/* Inbox slide-in panel */}
      {inboxOpen && (
        <>
          <div className="hub-panel-backdrop" onClick={() => setInboxOpen(false)} />
          <div className="hub-panel open hub-panel--inbox">
            <button className="hub-panel-close" onClick={() => setInboxOpen(false)} title="Close">✕</button>
            <div className="hub-panel-content">
              <Inbox onClose={() => setInboxOpen(false)} />
            </div>
          </div>
        </>
      )}

      {activePanel && !inboxOpen && (
        <>
          <div className="hub-panel-backdrop" onClick={closePanel} />
          {renderPanel()}
        </>
      )}
    </div>
  );
}
