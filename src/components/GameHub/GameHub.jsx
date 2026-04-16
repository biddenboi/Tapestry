import { useContext, useEffect } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { EVENT, GAME_STATE } from '../../utils/Constants.js';
import { getMidnightOfDate, getLocalDate } from '../../utils/Helpers/Time.js';
import { endDay, startDay } from '../../utils/Helpers/Events.js';
import Purgatory from '../../Modals/Purgatory/Purgatory.jsx';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup.jsx';
import Lobby from '../Lobby/Lobby.jsx';
import PracticeDojo from '../PracticeDojo/PracticeDojo.jsx';
import MatchArena from '../MatchArena/MatchArena.jsx';
import TodoList from '../TodoList/TodoList.jsx';
import Shop from '../../Pages/Shop/Shop.jsx';
import Inventory from '../../Pages/Inventory/Inventory.jsx';
import Settings from '../../Pages/Settings/Settings.jsx';
import Profile from '../../Pages/Profile/Profile.jsx';
import './GameHub.css';

const NAV = [
  { id: 'hub', label: 'HUB', icon: '◎', title: 'Lobby' },
  { id: 'tasks', label: 'TASK', icon: '☑', title: 'Task List' },
  { id: 'shop', label: 'SHOP', icon: '◈', title: 'Shop' },
  { id: 'inventory', label: 'INV', icon: '▤', title: 'Inventory' },
  { id: 'journal', label: 'LOG', icon: '✎', title: 'Journal' },
  { id: 'profile', label: 'PRF', icon: '◯', title: 'Profile' },
  { id: 'settings', label: 'CFG', icon: '✦', title: 'Settings' },
];

function forceCloseJournal() {
  document.dispatchEvent(new CustomEvent('force-close-journal'));
}

export default function GameHub() {
  const {
    databaseConnection,
    timestamp,
    currentPlayer,
    activeTask: [activeTask],
    gameState: [gameState],
    activePanel: [activePanel],
    viewingProfile: [viewingProfile],
    openPanel,
    closePanel,
  } = useContext(AppContext);

  useEffect(() => {
    let running = false;
    const syncDay = async () => {
      if (running) return;
      running = true;
      try {
        const player = await databaseConnection.getCurrentPlayer();
        if (!player?.createdAt) return;
        const lastEvent = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
        const midnight = getMidnightOfDate(getLocalDate(new Date()));

        if (!lastEvent) {
          await startDay(databaseConnection, player);
          return;
        }

        if (getLocalDate(new Date(lastEvent.createdAt)) < midnight) {
          if (lastEvent.type === EVENT.sleep) {
            await startDay(databaseConnection, player);
          } else {
            await endDay(databaseConnection, player, false);
            await startDay(databaseConnection, player);
          }
        }

        if (lastEvent.type === EVENT.sleep) {
          NiceModal.show(Purgatory);
        }
      } finally {
        running = false;
      }
    };
    syncDay();
  }, [databaseConnection, timestamp]);

  const handleNavClick = (id) => {
    if (id !== 'journal') forceCloseJournal();
    if (id === 'hub') {
      closePanel();
      return;
    }
    if (id === 'journal') {
      closePanel();
      NiceModal.show(JournalPopup);
      return;
    }
    if (activePanel === id) {
      closePanel();
      return;
    }
    openPanel(id);
  };

  const renderMain = () => {
    if (gameState === GAME_STATE.practice) return <PracticeDojo />;
    if (gameState === GAME_STATE.match) return <MatchArena />;
    return <Lobby />;
  };

  const renderPanel = () => {
    if (!activePanel) return null;
    const isFull = activePanel === 'shop' || activePanel === 'profile';
    let content = null;
    if (activePanel === 'tasks') content = <TodoList />;
    if (activePanel === 'shop') content = <Shop />;
    if (activePanel === 'inventory') content = <Inventory />;
    if (activePanel === 'settings') content = <Settings />;
    if (activePanel === 'profile') content = <Profile uuid={viewingProfile || currentPlayer?.UUID} />;
    if (!content) return null;

    return (
      <div className={`hub-panel open ${isFull ? 'hub-panel--full' : ''}`} key={activePanel}>
        <button className="hub-panel-close" onClick={closePanel} title="Close">✕</button>
        <div className="hub-panel-content">{content}</div>
      </div>
    );
  };

  return (
    <div className={`game-hub ${activeTask?.createdAt ? 'hub-in-session' : ''}`}>
      <aside className="hub-sidebar">
        <div className="hub-logo">T</div>
        <nav className="hub-nav">
          {NAV.map(({ id, label, icon, title }) => {
            const active = id === 'hub' ? !activePanel : activePanel === id;
            return (
              <button key={id} className={`hub-nav-btn ${active ? 'active' : ''}`} onClick={() => handleNavClick(id)} title={title}>
                <span className="hub-nav-icon">{icon}</span>
                <span className="hub-nav-label">{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="hub-sidebar-bottom">
          {!!activeTask?.createdAt && <div className="hub-session-dot" title="Session active" />}
          <button className="hub-sidebar-avatar-wrap" onClick={() => openPanel('profile')}>
            {currentPlayer?.profilePicture ? (
              <img src={currentPlayer.profilePicture} className="hub-sidebar-avatar" alt={currentPlayer?.username || 'Profile'} />
            ) : (
              <div className="hub-sidebar-avatar hub-sidebar-avatar--init">{currentPlayer?.username?.[0]?.toUpperCase() || '?'}</div>
            )}
          </button>
        </div>
      </aside>

      <main className="hub-main">{renderMain()}</main>

      {activePanel && (
        <>
          <div className="hub-panel-backdrop" onClick={closePanel} />
          {renderPanel()}
        </>
      )}
    </div>
  );
}
