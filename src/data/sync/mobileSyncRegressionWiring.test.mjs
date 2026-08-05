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
  assert.match(source, /publishCurrentMobileResources/);
  assert.match(source, /cancelScheduledSync/);
});

test('working-set repair is versioned, bounded, and records its applied generation', async () => {
  const source = await read('./MobileReferenceSync.js');
  assert.match(source, /MOBILE_WORKING_SET_MANIFEST_TYPE/);
  assert.match(source, /MOBILE_WORKING_SET_SCHEMA_VERSION = 4/);
  assert.match(source, /recordTime\(local\) > manifest\.publishedTime/);
  assert.match(source, /pruneMissing: true/);
  assert.match(source, /setMobileWorkingSetState/);
  assert.match(source, /void databaseConnection\.reconcileMissingMaterializedLeaderboards/);
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
  assert.match(lifecycle, /queueActiveProfileState/);
});

test('the server accepts active-profile state and persists delete tombstones', async () => {
  const migration = await read('../../../supabase/migrations/20260803010000_sync_convergence_hardening.sql');
  assert.match(migration, /'active-profile-state'/);
  assert.match(migration, /'mobile-working-set-manifest'/);
  assert.match(migration, /'__deleted',true/);
  assert.doesNotMatch(migration, /delete from public\.mobile_reference_records/);
  assert.match(migration, /drop function if exists public\.begin_mobile_reference_publish/);
});

test('the server mirrors routine dismissal and mobile Chronicle comments', async () => {
  const migration = await read('../../../supabase/migrations/20260803020000_mobile_social_and_routine_convergence.sql');
  assert.match(migration, /'journal-comment'/);
  assert.match(migration, /mirror_routine_entity_to_mobile_reference/);
  assert.match(migration, /new\.entity_type<>'routine-run'/);
  assert.match(migration, /sync_entity_mirror_routine_reference/);
});

test('Habit definitions and rhythms are mirrored through the durable reference protocol', async () => {
  const [sync, migration, sqliteCapture] = await Promise.all([
    read('./MobileReferenceSync.js'),
    read('../../../supabase/migrations/20260803030000_mobile_habits_convergence.sql'),
    read('../persistence/sqlite/migrations/055_habit_reference_capture.js'),
  ]);
  for (const recordType of ['custom-event', 'rhythm-definition', 'rhythm-opportunity']) {
    assert.match(sync, new RegExp(`'${recordType}'`));
    assert.match(migration, new RegExp(`'${recordType}'`));
  }
  assert.match(sqliteCapture, /customEvents/);
  assert.match(sqliteCapture, /rhythmDefinitions/);
  assert.match(sqliteCapture, /rhythmOpportunities/);
  assert.match(sqliteCapture, /sync_reference_capture_state/);
});

test('time-sensitive records use targeted reference lanes without publishing the full database', async () => {
  const [lanes, runtime, app] = await Promise.all([
    read('./ReferenceSyncLanes.js'),
    read('./SyncRuntime.js'),
    read('../../app/App.jsx'),
  ]);
  for (const recordType of ['active-profile-state', 'action-session', 'match', 'match-score-event']) {
    assert.match(lanes, new RegExp(`'${recordType}'`));
  }
  for (const recordType of [
    'goal', 'goal-area', 'goal-milestone', 'goal-update', 'goal-link',
  ]) {
    assert.match(lanes, new RegExp(`'${recordType}'`));
  }
  const promptTypes = lanes.match(/PROMPT_REFERENCE_TYPES = Object\.freeze\(\[[\s\S]*?\]\);/)?.[0] || '';
  for (const promptType of ['custom-event', 'rhythm-definition', 'rhythm-opportunity']) {
    assert.match(promptTypes, new RegExp(`'${promptType}'`));
  }
  for (const backgroundType of ['goal-contribution']) {
    assert.doesNotMatch(promptTypes, new RegExp(`'${backgroundType}'`));
  }
  assert.match(lanes, /flushReferenceOutbox\(\{ recordTypes: types/);
  assert.match(lanes, /getMobileReferenceChanges/);
  assert.match(lanes, /liveFollowUpRequested/);
  assert.match(runtime, /realtime-reference-nudge/);
  assert.doesNotMatch(lanes, /createCheckpoint|uploadCheckpoint|publishMobileBootstrapData/);
  assert.match(runtime, /flushReferenceOutbox\(\{ limit = 500, recordTypes = null \}/);
  assert.match(app, /queryResumableMobileMatch/);
  assert.match(app, /setGameState\(GAME_STATE\.match\)/);
});

test('desktop-trained ML artifacts are the only app settings admitted to mobile sync', async () => {
  const [sync, sqliteCapture, serverMigration] = await Promise.all([
    read('./MobileReferenceSync.js'),
    read('../persistence/sqlite/migrations/056_mobile_ml_model_reference_capture.js'),
    read('../../../supabase/migrations/20260803060000_mobile_ml_model_convergence.sql'),
  ]);
  assert.match(sync, /MOBILE_ML_MODEL_RECORD_TYPE = 'ml-model'/);
  assert.match(sync, /MOBILE_ML_MODEL_UUID_PREFIX = 'task-recommender-v12-'/);
  assert.match(sync, /recordType !== MOBILE_ML_MODEL_RECORD_TYPE/);
  assert.match(sqliteCapture, /NEW\.uuid LIKE '\$\{UUID_PREFIX\}%'/);
  assert.match(sqliteCapture, /sync_reference_capture_state/);
  assert.match(serverMigration, /'ml-model'/);
});

test('clean-device restore pages through the server primary-key index', async () => {
  const [transport, sync, migration] = await Promise.all([
    read('./supabase/SupabaseSyncTransport.js'),
    read('./MobileReferenceSync.js'),
    read('../../../supabase/migrations/20260803040000_paginated_reference_restore.sql'),
  ]);
  assert.match(transport, /getMobileReferenceRecordsPaginated/);
  assert.match(transport, /get_mobile_reference_records_page/);
  assert.match(sync, /getMobileReferenceRecordsPaginated/);
  assert.match(migration, /\(record_type,record_id\)>/);
  assert.match(migration, /limit v_limit/);
});

test('sync timeout remains a pending runtime concern instead of restarting bootstrap', async () => {
  const [runtime, desktopGate, mobileGate, pwa] = await Promise.all([
    read('./SyncRuntime.js'),
    read('../../app/data-source/DataSourceGate/DataSourceGate.jsx'),
    read('../../app/mobile/MobileCloudBootstrapGate.jsx'),
    read('../../shared/runtime/PwaRuntime.js'),
  ]);
  assert.match(runtime, /this\.retryAttempt \+= 1/);
  assert.match(runtime, /this\.statusStore\.setRuntimeError\(error\)/);
  assert.match(runtime, /this\.scheduleSync\('retry'\)/);
  assert.match(desktopGate, /Desktop bootstrap sync will retry in the background/);
  assert.match(mobileGate, /Mobile bootstrap sync will retry in the background/);
  assert.doesNotMatch(`${runtime}\n${desktopGate}\n${mobileGate}\n${pwa}`, /location\.reload/);
});
