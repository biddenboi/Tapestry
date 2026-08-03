import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentIGT } from '@domain/time/Time.js';
import {
  canRunInboxNotificationWork,
  getNextInboxDeliveryDeadline,
  unreadDeliveredNotifications,
} from '@domain/notifications/InboxNotificationPolicy.js';
import { useScheduledDeadline } from '@shared/hooks/useScheduledDeadline.js';

function browserPermission() {
  if (typeof Notification === 'undefined') return 'default';
  return Notification.permission || 'default';
}

export function useInboxNotificationCount({ databaseConnection, player, socialRevision }) {
  const playerRef = useRef(player);
  const requestGenerationRef = useRef(0);
  playerRef.current = player;
  const playerUUID = player?.UUID || null;
  const notificationSetting = player?.inboxNotificationsEnabled !== false;
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextDeliveryAt, setNextDeliveryAt] = useState(null);
  const [visibilityRevision, setVisibilityRevision] = useState(0);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibilityChange = () => setVisibilityRevision((revision) => revision + 1);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const refresh = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const isCurrent = () => requestGenerationRef.current === generation;
    const activePlayer = playerRef.current;
    if (!activePlayer?.UUID) {
      if (isCurrent()) {
        setUnreadCount(0);
        setNextDeliveryAt(null);
      }
      return;
    }
    const visible = typeof document === 'undefined' || !document.hidden;
    if (!canRunInboxNotificationWork({
      player: activePlayer,
      documentVisible: visible,
      sourcePermission: 'granted',
      browserPermission: browserPermission(),
    })) {
      if (isCurrent()) {
        setUnreadCount(0);
        setNextDeliveryAt(null);
      }
      return;
    }
    const currentIGT = getCurrentIGT(activePlayer);
    const notifications = await databaseConnection.getNotificationsForPlayer(activePlayer.UUID);
    const inboxNotifications = notifications.filter((notification) => notification.kind === 'friend_request');
    if (!isCurrent()) return;
    setUnreadCount(unreadDeliveredNotifications(inboxNotifications, currentIGT).length);
    setNextDeliveryAt(getNextInboxDeliveryDeadline(inboxNotifications, currentIGT));
  }, [databaseConnection]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((error) => {
      if (!cancelled) console.warn('[Inbox] notification count failed:', error);
    });
    return () => {
      cancelled = true;
      requestGenerationRef.current += 1;
    };
  }, [notificationSetting, playerUUID, refresh, socialRevision, visibilityRevision]);

  useScheduledDeadline(() => {
    refresh().catch((error) => console.warn('[Inbox] delivery deadline failed:', error));
  }, nextDeliveryAt, {
    enabled: !!nextDeliveryAt && (typeof document === 'undefined' || !document.hidden),
  });

  return unreadCount;
}
