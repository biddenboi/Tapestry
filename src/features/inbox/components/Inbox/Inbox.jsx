import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import {
  usePanelLifecycle,
  usePanelRequestScope,
} from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import { inboxNotificationWorkEnabled } from '@domain/notifications/InboxNotificationPolicy.js';
import ProfilePicture from '@shared/profile-picture/ProfilePicture.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, getCurrentIGT } from '@domain/time/Time.js';
import '@features/inbox/components/Inbox/Inbox.css';

export default function Inbox({ onClose }) {
  const { databaseConnection, currentPlayer, domainRevisions, invalidateDomains, openPanel } = useAppContext();
  const { canLoad } = usePanelLifecycle();
  const beginPanelRequest = usePanelRequestScope();
  const [notifications, setNotifications] = useState([]);
  const [senders, setSenders] = useState({});
  const [blockedReason, setBlockedReason] = useState('');
  const playerRef = useRef(currentPlayer);
  playerRef.current = currentPlayer;
  const playerUUID = currentPlayer?.UUID || null;
  const notificationsEnabled = inboxNotificationWorkEnabled(currentPlayer);

  const load = useCallback(async (request = null) => {
    if (!playerUUID || !notificationsEnabled) {
      setNotifications([]);
      setSenders({});
      setBlockedReason(notificationsEnabled ? '' : 'Inbox notifications are disabled in Settings.');
      return;
    }
    setBlockedReason('');
    const currentIGT = getCurrentIGT(playerRef.current);
    const notifs = await databaseConnection.getNotificationsForPlayer(playerUUID, currentIGT);
    if (request && !request.isCurrent()) return;
    const friendReqs = notifs.filter((notification) => notification.kind === 'friend_request' && !notification.readAt);
    friendReqs.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    setNotifications(friendReqs);

    const UUIDs = [...new Set(friendReqs.map((notification) => notification.meta?.requesterUUID).filter(Boolean))];
    const summaries = await Promise.all(UUIDs.map((UUID) => databaseConnection.get(STORES.profileSummary, UUID)));
    if (request && !request.isCurrent()) return;
    const byUUID = {};
    summaries.forEach((summary) => {
      if (summary?.player?.UUID) byUUID[summary.player.UUID] = summary.player;
    });
    setSenders(byUUID);
  }, [databaseConnection, notificationsEnabled, playerUUID]);

  useEffect(() => {
    if (!canLoad) return undefined;
    const request = beginPanelRequest();
    load(request)
      .catch((error) => console.warn('[Inbox] load failed:', error))
      .finally(request.finish);
    return request.cancel;
  }, [beginPanelRequest, canLoad, load, domainRevisions.social]);

  const handleNotifClick = async (notification) => {
    await databaseConnection.markNotificationRead(notification.UUID);
    invalidateDomains(DOMAIN_INVALIDATION.inboxWrite);
    onClose?.();
    const senderUUID = notification.meta?.requesterUUID;
    if (senderUUID) openPanel('profile', senderUUID);
  };

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="inbox-panel">
      <div className="inbox-header">
        <span className="inbox-title">INBOX</span>
        {unreadCount > 0 && <span className="inbox-badge">{unreadCount}</span>}
      </div>

      {blockedReason ? (
        <div className="inbox-empty">
          <span className="inbox-empty-icon">✉</span>
          <span>{blockedReason}</span>
        </div>
      ) : notifications.length === 0 ? (
        <div className="inbox-empty">
          <span className="inbox-empty-icon">✉</span>
          <span>No notifications yet.</span>
        </div>
      ) : (
        <div className="inbox-list">
          {notifications.map((notification) => {
            const sender = senders[notification.meta?.requesterUUID];
            const isUnread = !notification.readAt;
            return (
              <button
                key={notification.UUID}
                className={`inbox-item ${isUnread ? 'inbox-item--unread' : ''}`}
                onClick={() => handleNotifClick(notification)}
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
                  <div className="inbox-item-title">{notification.title}</div>
                  <div className="inbox-item-msg">{notification.message}</div>
                  <div className="inbox-item-time">
                    {UTCStringToLocalDate(notification.createdAt)} · {UTCStringToLocalTime(notification.createdAt)}
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
