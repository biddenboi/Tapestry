import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('routine sync no longer publishes or restores the full working set', async () => {
  const source = await read('./supabase/SupabaseSyncBootstrap.js');
  const afterSync = source.match(/this\.runtime\.afterSynchronize\s*=\s*async[\s\S]*?\n\s*};/)?.[0] || '';
  assert.match(afterSync, /synchronizeMobileReferenceData/);
  assert.doesNotMatch(afterSync, /publishMobileBootstrapData|restoreMobileBootstrapData/);
  assert.match(afterSync, /uploadReferences: false/);
  assert.match(afterSync, /flushReferenceOutbox/);
  assert.match(source, /cancelScheduledSync/);
});

test('working-set repair is versioned, bounded, and records its applied generation', async () => {
  const source = await read('./MobileReferenceSync.js');
  assert.match(source, /MOBILE_WORKING_SET_MANIFEST_TYPE/);
  assert.match(source, /MOBILE_WORKING_SET_SCHEMA_VERSION = 2/);
  assert.match(source, /recordTime\(local\) > manifest\.publishedTime/);
  assert.match(source, /pruneMissing: true/);
  assert.match(source, /setMobileWorkingSetState/);
});

test('active profile selection is a synchronized reference with a durable clock', async () => {
  const [sync, lifecycle, state] = await Promise.all([
    read('./MobileReferenceSync.js'),
    read('../persistence/services/ProfileLifecycleService.js'),
    read('../db/databaseConnectionUtils.js'),
  ]);
  assert.match(sync, /MOBILE_ACTIVE_PROFILE_RECORD_TYPE/);
  assert.match(sync, /forceActiveProfile/);
  assert.match(lifecycle, /activePlayerChangedAt/);
  assert.match(state, /activePlayerChangedAt/);
});
