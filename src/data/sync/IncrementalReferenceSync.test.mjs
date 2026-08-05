import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the app no longer polls Supabase for reference snapshots', async () => {
  const app = await read('../../app/App.jsx');
  assert.doesNotMatch(app, /setInterval\(reconcileLiveState,\s*1500\)/);
  assert.doesNotMatch(app, /setInterval\(reconcilePromptState,\s*4000\)/);
  assert.doesNotMatch(app, /visible-live-state|visible-prompt-state/);
  assert.match(app, /tapestry:reference-sync-complete/);
});

test('normal reference synchronization is cursor based and never calls full snapshot RPCs', async () => {
  const [lanes, sync, transport, bootstrap] = await Promise.all([
    read('./ReferenceSyncLanes.js'),
    read('./MobileReferenceSync.js'),
    read('./supabase/SupabaseSyncTransport.js'),
    read('./supabase/SupabaseSyncBootstrap.js'),
  ]);
  assert.match(lanes, /getMobileReferenceChanges/);
  assert.doesNotMatch(lanes, /getMobileReferenceRecords\(types\)/);
  assert.match(sync, /MOBILE_REFERENCE_CURSOR_STREAM/);
  assert.match(sync, /serverSequence/);
  assert.match(sync, /cursors\.advance/);
  assert.match(transport, /get_mobile_reference_changes/);
  assert.match(transport, /get_mobile_reference_head/);
  assert.match(bootstrap, /flushReferenceOutbox\(\)/);
  assert.match(bootstrap, /synchronizeMobileReferenceData/);
});

test('server migration assigns monotonic versions and exposes bounded owner deltas', async () => {
  const sql = await read('../../../supabase/migrations/20260805010000_incremental_mobile_reference_sync.sql');
  assert.match(sql, /mobile_reference_change_sequence/);
  assert.match(sql, /server_sequence/);
  assert.match(sql, /server_version/);
  assert.match(sql, /owner_id = v_owner_id/);
  assert.match(sql, /r\.server_sequence > v_after/);
  assert.match(sql, /limit v_limit/);
  assert.match(sql, /greatest\(1, least\(500/);
  assert.match(sql, /duplicate merge must not manufacture another delta/i);
  assert.match(sql, /grant execute on function public\.get_mobile_reference_changes/);
});
