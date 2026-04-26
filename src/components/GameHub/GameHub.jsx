import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { EVENT, GAME_STATE, STORES } from '../../utils/Constants.js';
import { getMidnightOfDate, getLocalDate, getMsUntilWakeTime } from '../../utils/Helpers/Time.js';
import { endDay, getSleepDateToday, getBackfilledSleepDate } from '../../utils/Helpers/Events.js';
import { getRankClass, getRankGlow } from '../../utils/Helpers/Rank.js';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup.jsx';
import ProfileSwitcher from '../../Modals/ProfileSwitcher/ProfileSwitcher.jsx';
import WakePopup, { getWakePendingStorageKey, getTodayDateStr } from '../../Modals/WakePopup/WakePopup.jsx';
import QuickNotes from '../../Modals/QuickNotes/QuickNotes.jsx';
import Purgatory from '../../Modals/Purgatory/Purgatory.jsx';
import Lobby from '../Lobby/Lobby.jsx';
import MatchArena from '../MatchArena/MatchArena.jsx';
import PracticeDojo from '../PracticeDojo/PracticeDojo.jsx';
import TodoList from '../TodoList/TodoList.jsx';
import Shop from '../../Pages/Shop/Shop.jsx';
import Inventory from '../../Pages/Inventory/Inventory.jsx';
import Settings from '../../Pages/Settings/Settings.jsx';
import Profile from '../../Pages/Profile/Profile.jsx';
import Events from '../../Pages/Events/Events.jsx';
import Inbox from '../Inbox/Inbox.jsx';
import GlobalChat from '../GlobalChat/GlobalChat.jsx';
import Feed from '../Feed/Feed.jsx';
import './GameHub.css';
import { Icon } from '../Icons/Icon.jsx';

const NAV = [
  { id: 'hub',       label: 'HUB',  title: 'Lobby' },
  { id: 'tasks',     label: 'TASK', title: 'Task List' },
  { id: 'events',    label: 'EVT',  title: 'Events' },
  { id: 'chat',      label: 'CHAT', title: 'Global Chat' },
  { id: 'feed',      label: 'FEED', title: 'Journal Feed' },
  { id: 'shop',      label: 'SHOP', title: 'Shop' },
  { id: 'inventory', label: 'INV',  title: 'Inventory' },
  { id: 'journal',   label: 'LOG',  title: 'Journal' },
  { id: 'profile',   label: 'PRF',  title: 'Profile' },
  { id: 'settings',  label: 'CFG',  title: 'Settings' },
];

// ── Module-level firing latches ─────────────────────────────────────────
// These live outside the component so they survive React re-mounts within
// the same tab session. Each entry is the composite key `${UUID}_${date}`
// of the most recent fire. A subsequent tick that matches the latched key
// is a no-op. The latches reset implicitly when player/date changes.
const dayFireLatch = { wakePopupShown: null, endDayFired: null };

function forceCloseJournal() {
  document.dispatchEvent(new CustomEvent('force-close-journal'));
}

export default function GameHub() {
  const {
    databaseConnection,
    timestamp,
    currentPlayer,
    notify,
    refreshApp,
    activeTask: [activeTask],
    gameState: [gameState],
    activePanel: [activePanel],
    viewingProfile: [viewingProfile],
    openPanel,
    closePanel,
  } = useContext(AppContext);

  const sleepCheckFiredRef = useRef(false);
  const notifyRef = useRef(notify);
  useEffect(() => { notifyRef.current = notify; }, [notify]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  /* ── EOD choice persistence helpers ────────────────────── */
  // Key: tapestry_eod_<playerUUID>_<YYYY-MM-DD>
  // Value: 'purgatory' | 'skip' (set the moment the user clicks a choice)
  const eodKey = useCallback((playerUUID, dateStr) =>
    `tapestry_eod_${playerUUID}_${dateStr}`, []);

  const getLocalDateStr = useCallback((date = new Date()) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

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

  /* Reload-resilience: if we were mid-WakePopup and the page reloaded,
     re-show it before syncDay does its routing. */
  useEffect(() => {
    if (!currentPlayer?.UUID) return;
    const key = getWakePendingStorageKey(currentPlayer.UUID, getTodayDateStr());
    if (localStorage.getItem(key) === 'shown') {
      NiceModal.show(WakePopup);
    }
  }, [currentPlayer]);

  useEffect(() => {
    let running = false;
    const syncDay = async () => {
      if (running) return;
      running = true;
      try {
        const player = await databaseConnection.getCurrentPlayer();
        if (!player?.createdAt) {
          // No profile exists yet — show the profile creator so the user can
          // set up their first profile. ProfileSwitcher handles null currentPlayer
          // gracefully and chains into WakePopup after creation.
          NiceModal.show(ProfileSwitcher, { skipPurgatory: true });
          return;
        }

        const lastEvent    = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep], player.UUID);
        const midnight     = getMidnightOfDate(getLocalDate(new Date()));
        const todayStr     = getLocalDateStr();
        const dayKey       = `${player.UUID}_${todayStr}`;
        const eodKeyMaker  = (uid, dateStr) => `tapestry_eod_${uid}_${dateStr}`;
        const wakePendingKey = getWakePendingStorageKey(player.UUID, todayStr);

        const showWakePopupOnce = () => {
          if (dayFireLatch.wakePopupShown === dayKey) return;
          dayFireLatch.wakePopupShown = dayKey;
          localStorage.setItem(wakePendingKey, 'shown');
          NiceModal.show(WakePopup);
        };

        // ── No history yet: brand new player ──────────────────────
        // Even first-ever launch goes through WakePopup. The new day starts
        // when the user confirms — never silently.
        if (!lastEvent) {
          showWakePopupOnce();
          return;
        }

        const lastEventDate = getLocalDate(new Date(lastEvent.createdAt));

        // ── Last event is from a previous day ─────────────────────
        if (lastEventDate < midnight) {
          if (lastEvent.type === EVENT.sleep) {
            // Slept properly. Route directly to WakePopup so the player can
            // confirm the new day whenever they're ready. (Purgatory removed.)
            showWakePopupOnce();
            sleepCheckFiredRef.current = false;
          } else {
            // Missed deadline: app wasn't open during the sleep→wake window.
            // Backfill the sleep event, forfeit tokens, route to ProfileSwitcher
            // with skipPurgatory so the new day starts as soon as a profile is
            // chosen (ProfileSwitcher will hand off to WakePopup).
            const eodDateStr = getLocalDateStr(lastEvent.createdAt);
            const key        = eodKeyMaker(player.UUID, eodDateStr);
            const choice     = localStorage.getItem(key);
            if (!choice) {
              if (dayFireLatch.endDayFired === `${player.UUID}_${eodDateStr}`) return;
              dayFireLatch.endDayFired = `${player.UUID}_${eodDateStr}`;
              const backfilledSleepDate = getBackfilledSleepDate(player.sleepTime, lastEvent.createdAt);
              await endDay(databaseConnection, player, true, backfilledSleepDate.toISOString());
              notifyRef.current({ title: 'Missed Bedtime', message: 'Your sleep time passed without ending the day. All tokens forfeited.', kind: 'error', persist: true });
              NiceModal.show(ProfileSwitcher, { skipPurgatory: true, eodDateStr });
            } else if (choice === 'chosen') {
              // User already picked their profile — route to WakePopup.
              showWakePopupOnce();
            }
            // 'starting' means the flow is mid-handoff — do nothing.
          }
          return;
        }

        // ── Last event is from today ──────────────────────────────
        if (lastEvent.type === EVENT.sleep) {
          // We're between today's sleep time and tomorrow's wake time.
          const eodDateStr = getLocalDateStr(lastEvent.createdAt);
          const key        = eodKeyMaker(player.UUID, eodDateStr);
          const choice     = localStorage.getItem(key);
          if (choice) {
            // User already confirmed end-of-day choice — show WakePopup.
            showWakePopupOnce();
          } else {
            NiceModal.show(ProfileSwitcher, { skipPurgatory: false, eodDateStr });
          }
          return;
        }

        // ── Active day: watch for sleep time ─────────────────────
        if (!sleepCheckFiredRef.current) {
          const sleepDate = getSleepDateToday(player.sleepTime);
          if (sleepDate && Date.now() >= sleepDate.getTime()) {
            // Latch BEFORE the await to prevent re-entrancy on the next tick.
            sleepCheckFiredRef.current = true;
            const eodDateStr = todayStr;
            if (dayFireLatch.endDayFired === `${player.UUID}_${eodDateStr}`) return;
            dayFireLatch.endDayFired = `${player.UUID}_${eodDateStr}`;
            const key        = eodKeyMaker(player.UUID, eodDateStr);
            const choice     = localStorage.getItem(key);
            if (!choice) {
              await endDay(databaseConnection, player, true);
              notifyRef.current({ title: 'Sleep Time', message: 'Your scheduled bedtime has passed. All tokens forfeited.', kind: 'error', persist: true });
              NiceModal.show(ProfileSwitcher, { skipPurgatory: false, eodDateStr });
            } else {
              NiceModal.show(Purgatory);
            }
          }
        }
      } finally {
        running = false;
      }
    };
    syncDay();
  }, [databaseConnection, timestamp, getLocalDateStr]);

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
    if (gameState === GAME_STATE.match) return <MatchArena />;
    if (gameState === GAME_STATE.dojo)  return <PracticeDojo />;
    return <Lobby />;
  };

  const renderPanel = () => {
    if (!activePanel) return null;
    const isFull = activePanel === 'shop' || activePanel === 'profile' || activePanel === 'feed' || activePanel === 'events';
    let content = null;
    if (activePanel === 'tasks')     content = <TodoList />;
    if (activePanel === 'queue')     content = <TodoList fromQueue />;
    if (activePanel === 'events')    content = <Events />;
    if (activePanel === 'chat')      content = <GlobalChat />;
    if (activePanel === 'feed')      content = <Feed />;
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
          {NAV.map(({ id, label, title }) => {
            const active = id === 'hub' ? !activePanel && !inboxOpen : activePanel === id;
            return (
              <button
                key={id}
                className={`hub-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleNavClick(id)}
                title={title}
              >
                <span className="hub-nav-icon">
                  <Icon name={id === 'journal' ? 'journal' : id} size={20} />
                </span>
                <span className="hub-nav-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hub-sidebar-bottom">
          {/* Quick notes */}
          <button
            className="hub-inbox-btn hub-notes-btn"
            onClick={() => { setInboxOpen(false); NiceModal.show(QuickNotes); }}
            title="Quick Notes"
          >
            <span className="hub-inbox-icon"><Icon name="notes" size={20} /></span>
          </button>

          {/* Inbox bell */}
          <button
            className={`hub-inbox-btn ${inboxOpen ? 'active' : ''}`}
            onClick={toggleInbox}
            title="Inbox"
          >
            <span className="hub-inbox-icon"><Icon name="inbox" size={20} /></span>
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