import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../../../../supabase/migrations/20260802120000_cross_device_sync_server.sql', import.meta.url);
const bootstrapMigrationUrl = new URL('../../../../supabase/migrations/20260802210000_mobile_cloud_bootstrap.sql', import.meta.url);
const matchMigrationUrl = new URL('../../../../supabase/migrations/20260802235900_match_sync.sql', import.meta.url);

test('server migration is exact-owner, RLS-protected, and client-owner agnostic', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /values \('yujinpetercho@gmail\.com'\)/);
  assert.doesNotMatch(sql, /values \('oatstakes@gmail\.com'\)/);
  for (const table of ['tapestry_owner_allowlist', 'sync_devices', 'sync_entities', 'sync_events', 'sync_log']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(sql, /v_owner_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(sql, /p_owner_id\s+/i);
  assert.match(sql, /security definer/g);
  assert.match(sql, /set search_path = pg_catalog, public/g);
  assert.match(sql, /revoke all on public\.sync_log from anon/i);
  assert.match(sql, /pg_advisory_xact_lock/);
});

test('server exposes command-specific validation and keeps purchases authoritative', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const command of [
    'completeTaskOccurrence',
    'startActionSession',
    'recordMatchScoreEvent',
    'recordRewardProvenance',
    'createTask',
    'updateTask',
  ]) {
    assert.match(sql, new RegExp(`'${command}'`));
  }
  assert.match(sql, /online-command-not-implemented/);
  assert.match(sql, /Shop purchases require the server-authoritative purchase endpoint/);
});

test('clean-device bootstrap stays owner-scoped, bounded, and attachment-free', async () => {
  const sql = await readFile(bootstrapMigrationUrl, 'utf8');
  assert.match(sql, /v_owner_id uuid := auth\.uid\(\)/);
  assert.match(sql, /public\.is_tapestry_owner\(\)/);
  assert.match(sql, /jsonb_array_length\(p_records\)>1000/);
  assert.match(sql, /octet_length\(\(v_record->'data'\)::text\)>1048576/);
  for (const recordType of [
    'profile', 'task', 'reminder', 'journal', 'action-session',
    'shop-catalog', 'inventory', 'routine-run', 'effect-interval',
  ]) {
    assert.match(sql, new RegExp(`'${recordType}'`));
  }
  assert.doesNotMatch(sql, /'resource'|'attachment'|'derived-cache'|'model-weight'/);
  assert.match(sql, /revoke all on function public\.merge_mobile_reference_records\(jsonb\) from public,anon/);
  assert.match(sql, /grant execute on function public\.merge_mobile_reference_records\(jsonb\) to authenticated/);
});

test('Match lifecycle sync is owner-scoped, bounded, idempotent, and registered-device-only', async () => {
  const sql = await readFile(matchMigrationUrl, 'utf8');
  assert.match(sql, /v_owner_id uuid := auth\.uid\(\)/);
  assert.match(sql, /public\.is_tapestry_owner\(\)/);
  assert.match(sql, /jsonb_array_length\(p_operations\)>100/);
  assert.match(sql, /octet_length\(v_payload::text\)>2097152/);
  assert.match(sql, /v_command_type not in \('createMatch','updateMatch','completeMatch'\)/);
  assert.match(sql, /public\.sync_devices/);
  assert.match(sql, /retired_at is null/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /':match:' \|\| v_entity_id/);
  assert.match(sql, /v_current_status in \('complete','cancelled'\) then false/);
  assert.match(sql, /broadcast the[\s\S]*current canonical snapshot/);
  assert.match(sql, /where owner_id=v_owner_id and operation_id=v_operation_id/);
  assert.match(sql, /revoke all on function public\.apply_match_sync_batch\(jsonb\) from public,anon/);
  assert.match(sql, /grant execute on function public\.apply_match_sync_batch\(jsonb\) to authenticated/);
});
