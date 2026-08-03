export const INBOX_NOTIFICATION_SETTING = 'inboxNotificationsEnabled';

export function inboxNotificationWorkEnabled(player) {
  return player?.[INBOX_NOTIFICATION_SETTING] !== false;
}

export function canRunInboxNotificationWork({
  player,
  documentVisible = true,
  sourcePermission = 'granted',
  browserPermission = 'default',
} = {}) {
  return !!player?.UUID
    && inboxNotificationWorkEnabled(player)
    && documentVisible
    && sourcePermission === 'granted'
    && browserPermission !== 'denied';
}

export function unreadDeliveredNotifications(notifications = [], currentIGT = Infinity) {
  const boundary = Number.isFinite(Number(currentIGT)) ? Number(currentIGT) : Infinity;
  return notifications.filter((notification) => (
    !notification?.readAt
    && Number(notification?.inGameTimestamp || 0) <= boundary
  ));
}

export function getNextInboxDeliveryDeadline(notifications = [], currentIGT = 0, now = Date.now()) {
  const boundary = Number(currentIGT) || 0;
  const currentTime = Number(now) || Date.now();
  const offsets = notifications
    .filter((notification) => !notification?.readAt)
    .map((notification) => Number(notification?.inGameTimestamp || 0) - boundary)
    .filter((offset) => Number.isFinite(offset) && offset > 0)
    .sort((left, right) => left - right);
  return offsets.length ? new Date(currentTime + offsets[0]).toISOString() : null;
}
