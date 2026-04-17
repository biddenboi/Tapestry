import { useContext, useEffect, useState, useCallback } from 'react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, getCurrentIGT } from '../../utils/Helpers/Time.js';
import './Inbox.css';

export default function Inbox({ onClose }) {
  const { databaseConnection, currentPlayer, timestamp, refreshApp, openPanel } = useContext(AppContext);
  const [notifications, setNotifications] = useState([]);
  const [senders, setSenders] = useState({});

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    // Only show notifications that have been "delivered" — i.e. their inGameTimestamp
    // is <= the current player's current IGT. This mirrors the in-game time illusion.
    const currentIGT = getCurrentIGT(currentPlayer);
    const notifs = await databaseConnection.getNotificationsForPlayer(currentPlayer.UUID, currentIGT);
    const friendReqs = notifs.filter((n) => n.kind === 'friend_request');
    friendReqs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    setNotifications(friendReqs);

    // Load sender profiles
    const uuids = [...new Set(friendReqs.map((n) => n.meta?.requesterUUID).filter(Boolean))];
    const profiles = await Promise.all(uuids.map((id) => databaseConnection.get(STORES.player, id)));
    const map = {};
    profiles.forEach((p) => { if (p) map[p.UUID] = p; });
    setSenders(map);
  }, [databaseConnection, currentPlayer]);

  useEffect(() => { load(); }, [load, timestamp]);

  const handleNotifClick = async (notif) => {
    // Mark as read
    await databaseConnection.markNotificationRead(notif.UUID);
    refreshApp();
    onClose?.();
    // Navigate to sender's profile
    const senderUUID = notif.meta?.requesterUUID;
    if (senderUUID) openPanel('profile', senderUUID);
  };

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="inbox-panel">
      <div className="inbox-header">
        <span className="inbox-title">INBOX</span>
        {unreadCount > 0 && <span className="inbox-badge">{unreadCount}</span>}
      </div>

      {notifications.length === 0 ? (
        <div className="inbox-empty">
          <span className="inbox-empty-icon">✉</span>
          <span>No notifications yet.</span>
        </div>
      ) : (
        <div className="inbox-list">
          {notifications.map((notif) => {
            const sender = senders[notif.meta?.requesterUUID];
            const isUnread = !notif.readAt;
            return (
              <button
                key={notif.UUID}
                className={`inbox-item ${isUnread ? 'inbox-item--unread' : ''}`}
                onClick={() => handleNotifClick(notif)}
              >
                <div className="inbox-item-avatar">
                  <ProfilePicture
                    src={sender?.profilePicture}
                    username={sender?.username || '?'}
                    size={40}
                  />
                  {isUnread && <span className="inbox-item-dot" />}
                </div>
                <div className="inbox-item-body">
                  <div className="inbox-item-title">{notif.title}</div>
                  <div className="inbox-item-msg">{notif.message}</div>
                  <div className="inbox-item-time">
                    {UTCStringToLocalDate(notif.createdAt)} · {UTCStringToLocalTime(notif.createdAt)}
                  </div>
                </div>
                <div className="inbox-item-arrow">›</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
