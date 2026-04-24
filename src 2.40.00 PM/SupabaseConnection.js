/**
 * SupabaseConnection
 * Drop-in replacement for DatabaseConnection.
 * Mirrors the same public API so the rest of the codebase needs minimal changes.
 *
 * Key differences:
 *  - No STORES constants needed internally; we map them to Supabase table names.
 *  - "player" operations (STORES.player) map to the `profiles` table.
 *  - All queries are scoped to auth.uid() via RLS — no manual UUID filtering needed
 *    for security, but we still pass user_id on inserts.
 */

import { supabase } from './supabaseClient.js';
import { STORES } from '../utils/Constants.js';

// ── Table name map ────────────────────────────────────────────────────────────
const TABLE = {
  [STORES.todo]:    'todos',
  [STORES.task]:    'tasks',
  [STORES.journal]: 'journals',
  [STORES.player]:  'profiles',   // special-cased below
};

// ── camelCase ↔ snake_case field maps ─────────────────────────────────────────
// Only fields that differ; everything else passes through as-is.
const TO_ROW = {
  estimatedDuration: 'estimated_duration',
  dueDate:           'due_date',
  isLabel:           'is_label',
  isRoot:            'is_root',
  completedAt:       'completed_at',
  treeId:            'tree_id',
  parentNodeId:      'parent_node_id',
  reasonToSelect:    'reason_to_select',
  nodeId:            'node_id',
  createdAt:         'created_at',
  userId:            'user_id',
};

const FROM_ROW = Object.fromEntries(Object.entries(TO_ROW).map(([k, v]) => [v, k]));

function toRow(obj) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) {
    row[TO_ROW[k] || k] = v;
  }
  return row;
}

function fromRow(row) {
  if (!row) return null;
  const obj = {};
  for (const [k, v] of Object.entries(row)) {
    obj[FROM_ROW[k] || k] = v;
  }
  // Normalise UUID → always uppercase key in JS objects
  if (obj.uuid && !obj.UUID) { obj.UUID = obj.uuid; delete obj.uuid; }
  return obj;
}

function fromRows(rows) {
  return (rows || []).map(fromRow);
}

// ── Main class ────────────────────────────────────────────────────────────────
class SupabaseConnection {

  // ── Auth helpers ─────────────────────────────────────────────────────────

  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  /**
   * Returns a "player-shaped" object the rest of the app expects.
   * UUID === auth user id.
   * Auto-creates the profile row if it doesn't exist yet
   * (the trigger handles it on signup, but this is a safety net).
   */
  async getOrCreatePlayer() {
    const user = await this.getUser();
    if (!user) return null;

    let { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !profile) {
      const { data: newProfile } = await supabase
        .from('profiles')
        .upsert({ id: user.id, blocked: false })
        .select()
        .single();
      profile = newProfile;
    }

    return this._playerFromProfile(profile, user);
  }

  _playerFromProfile(profile, user) {
    if (!profile) return null;
    return {
      UUID:       profile.id,
      accessKey:  profile.access_key ?? null,
      blocked:    profile.blocked ?? false,
      email:      user?.email ?? null,
      hasAccess:  !!(profile.access_key) && !(profile.blocked),
    };
  }

  /** Claim an access key via the server-side RPC. */
  async claimAccessKey(key) {
    const { data, error } = await supabase.rpc('claim_access_key', { p_key: key });
    if (error) return { success: false, error: error.message };
    return data;
  }

  // ── Generic CRUD ──────────────────────────────────────────────────────────

  /**
   * Upsert a record. Mirrors the old `add(store, data)` signature.
   * For STORES.player it updates the profiles table instead.
   */
  async add(store, data) {
    const user = await this.getUser();
    if (!user) throw new Error('Not authenticated');

    // STORES.player only needs access_key / blocked updates — no tokens
    if (store === STORES.player) return;

    const table = TABLE[store];
    if (!table) throw new Error(`Unknown store: ${store}`);

    // Map to snake_case, inject user_id, strip legacy fields that
    // don't exist as columns in Supabase (parent, treeName, tokens)
    const row = toRow({ ...data });
    row.user_id = user.id;

    // Lowercase uuid key for Supabase primary key
    if (row.UUID) { row.uuid = row.UUID; delete row.UUID; }

    // Strip fields that only existed in the old IndexedDB schema
    delete row.parent;      // replaced by user_id via RLS
    delete row.treeName;    // UI-only enrichment field, not stored
    delete row.tokens;      // removed concept

    const { error } = await supabase.from(table).upsert(row);
    if (error) throw error;
  }

  async get(store, UUID) {
    const table = TABLE[store];
    if (!table) return null;
    const { data, error } = await supabase.from(table).select('*').eq('uuid', UUID).single();
    if (error) return null;
    return fromRow(data);
  }

  async remove(store, UUID) {
    const table = TABLE[store];
    if (!table) return;
    const { error } = await supabase.from(table).delete().eq('uuid', UUID);
    if (error) throw error;
  }

  async getAll(store) {
    const user = await this.getUser();
    if (!user) return [];
    const table = TABLE[store];
    if (!table) return [];
    const { data, error } = await supabase.from(table).select('*').eq('user_id', user.id);
    if (error) return [];
    return fromRows(data);
  }

  // ── Player-scoped store queries ───────────────────────────────────────────

  /** Fetch all records of a store that belong to the current user. */
  async getPlayerStore(store, _playerUUID) {
    // RLS already scopes to the current user — ignore playerUUID
    return this.getAll(store);
  }

  // ── Tree helpers ──────────────────────────────────────────────────────────

  async getTreeNodes(treeId) {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .eq('tree_id', treeId);
    if (error) return [];
    return fromRows(data);
  }

  async getPlayerTrees(_playerUUID) {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .eq('is_root', true);
    if (error) return [];
    return fromRows(data);
  }

  // ── Journal helpers ───────────────────────────────────────────────────────

  async getAllJournals() {
    const user = await this.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('journals')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return [];
    return fromRows(data);
  }

  async getAllTasks() {
    const user = await this.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return [];
    return fromRows(data);
  }

  // ── Data export ───────────────────────────────────────────────────────────

  async getDataAsJSON() {
    const [todos, tasks, journals] = await Promise.all([
      this.getAll(STORES.todo),
      this.getAll(STORES.task),
      this.getAll(STORES.journal),
    ]);
    const data = { todos, tasks, journals };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'canopy-data.json'; a.click();
    URL.revokeObjectURL(url);
  }

  // Import data from a previously exported JSON file.
  // Upserts all records — existing records with the same UUID are overwritten.
  async dataUpload(jsonString) {
    let data;
    try { data = JSON.parse(jsonString); } catch { throw new Error('Invalid JSON file.'); }

    const storeMap = {
      todos:    STORES.todo,
      tasks:    STORES.task,
      journals: STORES.journal,
    };

    for (const [key, store] of Object.entries(storeMap)) {
      const records = data[key];
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        try { await this.add(store, record); } catch { /* skip invalid records */ }
      }
    }
  }
}

export default SupabaseConnection;
