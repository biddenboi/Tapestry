import test from 'node:test';
import assert from 'node:assert/strict';
import { queueProfileWrite } from './ProfileWriteQueue.js';
import { saveSharedRitualSettings } from '../events/SharedRitualSettings.js';

test('overlapping policy and general settings saves preserve both changes and profile data', async () => {
  let stored = { UUID: 'profile', username: 'Original', points: 42, wakeChecklist: [], sleepChecklist: [] };
  const database = {
    async getAll() { return [structuredClone(stored)]; },
    async commitAtomicMutation({ puts }) { stored = structuredClone(puts[0].record); },
  };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const policy = queueProfileWrite(database, async () => {
    const latest = structuredClone(stored);
    await gate;
    stored = { ...latest, inboxNotificationsEnabled: false };
  });
  const general = saveSharedRitualSettings(database, stored, { activePatch: { username: 'Updated' } });
  release();
  await Promise.all([policy, general]);
  assert.equal(stored.username, 'Updated');
  assert.equal(stored.inboxNotificationsEnabled, false);
  assert.equal(stored.points, 42);
});

test('a failed profile save does not block the next edit or another database', async () => {
  const connection = {};
  const failed = queueProfileWrite(connection, async () => { throw new Error('Disk full'); });
  const next = queueProfileWrite(connection, async () => 'saved');
  await assert.rejects(failed, /Disk full/);
  assert.equal(await next, 'saved');
  assert.equal(await queueProfileWrite({}, async () => 'independent'), 'independent');
});

test('saving one general field keeps ritual changes received since the form opened', async () => {
  const stale = { UUID: 'profile', username: 'Old', wakeChecklist: ['Old checklist'], sleepChecklist: [] };
  let stored = { ...stale, wakeChecklist: ['Newer checklist'], sleepTime: '22:00' };
  const database = {
    async getAll() { return [stored]; },
    async commitAtomicMutation({ puts }) { stored = puts[0].record; },
  };
  await saveSharedRitualSettings(database, stale, { activePatch: { username: 'New' } });
  assert.deepEqual(stored.wakeChecklist, ['Newer checklist']);
  assert.equal(stored.sleepTime, '22:00');
  assert.equal(stored.username, 'New');
});
