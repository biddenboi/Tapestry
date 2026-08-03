import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [inbox, gameHub, hook, requirements, settings] = await Promise.all([
  read('./Inbox.jsx'),
  read('../../../../app/shell/GameHub/GameHub.jsx'),
  read('../../../../app/shell/GameHub/hooks/useInboxNotificationCount.js'),
  read('../../../../app/data-source/panelDomainRequirements.js'),
  read('../../../settings/pages/Settings/Settings.jsx'),
]);

test('Inbox subscribes only to social changes and compact sender summaries', () => {
  assert.match(requirements, /inbox: Object\.freeze\(\[D\.social, D\.profileSummaries\]\)/);
  assert.match(inbox, /domainRevisions\.social/);
  assert.doesNotMatch(inbox, /domainRevisions\.profiles/);
  assert.match(inbox, /STORES\.profileSummary/);
  assert.doesNotMatch(inbox, /databaseConnection\.get\(STORES\.player/);
});

test('background unread work is disabled, visibility-aware, permission-aware, and deadline scheduled', () => {
  assert.match(gameHub, /useInboxNotificationCount/);
  assert.match(hook, /canRunInboxNotificationWork/);
  assert.match(hook, /document\.hidden/);
  assert.match(hook, /Notification\.permission/);
  assert.match(hook, /useScheduledDeadline/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.match(settings, /Inbox Notifications/);
  assert.match(settings, /inboxNotificationsEnabled/);
});
