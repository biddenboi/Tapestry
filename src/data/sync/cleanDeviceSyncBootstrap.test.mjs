import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('clean-device bootstrap configures transport without starting sync before restore', async () => {
  const source = await read('./supabase/SupabaseSyncBootstrap.js');
  assert.match(source, /configure\(\{ transport, device, schedule: false \}\)/);
  assert.match(source, /if \(shouldStartRoutineSync\)/);
  assert.doesNotMatch(source, /await this\.runtime\.synchronize\(\{ reason: 'supabase-session-configured' \}\)/);
});

test('cloud checkpoint upload does not block the sync transaction', async () => {
  const source = await read('./supabase/SupabaseSyncBootstrap.js');
  assert.match(source, /void this\.runtime\.publishCloudCheckpoint/);
  assert.doesNotMatch(source, /const checkpoint = await this\.runtime\.publishCloudCheckpoint/);
  assert.doesNotMatch(source, /background-durability-flush|pagehide-durability-flush/);
});

test('tab hiding does not launch another full synchronization', async () => {
  const source = await read('./SyncCoordinator.js');
  assert.match(source, /if \(state === 'visible'\) this\.requestSync\('foreground'\)/);
  assert.doesNotMatch(source, /state === 'hidden'/);
  assert.doesNotMatch(source, /pagehide/);
});

test('account panel does not present runtime syncing as account connection state', async () => {
  const source = await read('../../features/settings/components/SyncAccountPanel/SyncAccountPanel.jsx');
  assert.match(source, /Private account connected/);
  assert.doesNotMatch(source, /effectiveSyncStatus|runtimeSnapshot|runtimeStore/);
});
