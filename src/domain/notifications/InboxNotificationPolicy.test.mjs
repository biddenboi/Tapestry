import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./InboxNotificationPolicy.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  canRunInboxNotificationWork,
  getNextInboxDeliveryDeadline,
  unreadDeliveredNotifications,
} = await import(moduleUrl);

test('notification work stops for disabled, hidden, or permission-denied states', () => {
  const player = { UUID: 'p1' };
  assert.equal(canRunInboxNotificationWork({ player }), true);
  assert.equal(canRunInboxNotificationWork({ player: { ...player, inboxNotificationsEnabled: false } }), false);
  assert.equal(canRunInboxNotificationWork({ player, documentVisible: false }), false);
  assert.equal(canRunInboxNotificationWork({ player, sourcePermission: 'denied' }), false);
  assert.equal(canRunInboxNotificationWork({ player, browserPermission: 'denied' }), false);
});

test('delivery count and deadline are derived without polling', () => {
  const notifications = [
    { UUID: 'n1', inGameTimestamp: 50, readAt: null },
    { UUID: 'n2', inGameTimestamp: 150, readAt: null },
    { UUID: 'n3', inGameTimestamp: 25, readAt: 'read' },
  ];
  assert.deepEqual(unreadDeliveredNotifications(notifications, 100).map((row) => row.UUID), ['n1']);
  assert.equal(getNextInboxDeliveryDeadline(notifications, 100, 1000), new Date(1050).toISOString());
});
