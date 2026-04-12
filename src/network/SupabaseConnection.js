/**
 * SupabaseConnection — drop-in replacement for DatabaseConnection.
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON } from './supabaseClient.js';
import { STORES } from '../utils/Constants.js';
import {
  getSnapshot,
  updateSnapshot,
  enqueueOperation,
  getQueuedOperations,
  removeQueuedOperation,
  getPendingCount,
} from './localCache.js';

// ── Table name map ────────────────────────────────────────────────────────────
const TABLE = {
  [STORES.todo]:    'todos',
  [STORES.task]:    'tasks',
  [STORES.journal]: 'journals',
  [STORES.player]:  'profiles',
};

const STORE_FIELDS = {
  [STORES.todo]: [
    'UUID', 'name', 'efficiency', 'estimatedDuration', 'dueDate', 'isLabel',
    'treeId', 'parentNodeId', 'isRoot', 'completed', 'completedAt', 'createdAt',
    'reasonToSelect', 'posX', 'posY', 'isNote',
  ],
  [STORES.task]: [
    'UUID', 'name', 'estimatedDuration', 'completedAt', 'createdAt', 'nodeId',
  ],
  [STORES.journal]: [
    'UUID', 'title', 'entry', 'createdAt',
  ],
};

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
  posX:              'pos_x',
  posY:              'pos_y',
  isNote:            'is_note',
};

const FROM_ROW = Object.fromEntries(Object.entries(TO_ROW).map(([k, v]) => [v, k]));

function toRow(obj) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) { row[TO_ROW[k] || k] = v; }
  return row;
}

function fromRow(row) {
  if (!row) return null;
  const obj = {};
  for (const [k, v] of Object.entries(row)) { obj[FROM_ROW[k] || k] = v; }
  if (obj.uuid && !obj.UUID) { obj.UUID = obj.uuid; delete obj.uuid; }
  return obj;
}

function fromRows(rows) { return (rows || []).map(fromRow); }

// ── Main class ────────────────────────────────────────────────────────────────
class SupabaseConnection {

  constructor() {
    this._flushPromise = null;
    this._sessionUser  = null;
    this._lastConnectivityCheckAt = 0;
    this._lastConnectivityResult  = true;
  }

  setSessionUser(user) { this._sessionUser = user || null; }
  _isOnline()          { return this._lastConnectivityResult; }

  async checkConnectivity({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - this._lastConnectivityCheckAt < 5000) return this._lastConnectivityResult;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      this._lastConnectivityCheckAt = now; this._lastConnectivityResult = true; return true;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this._lastConnectivityCheckAt = now; this._lastConnectivityResult = false; return false;
    }
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'GET', cache: 'no-store', mode: 'cors',
        headers: { apikey: SUPABASE_ANON },
        signal: controller.signal,
      });
      this._lastConnectivityResult = true;
    } catch {
      this._lastConnectivityResult = false;
    } finally {
      clearTimeout(timeout);
      this._lastConnectivityCheckAt = now;
    }
    return this._lastConnectivityResult;
  }

  _notifyLocalChange() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('canopy-local-data-changed'));
    }
  }

  _storeKey(store) {
    switch (store) {
      case STORES.todo:    return 'todos';
      case STORES.task:    return 'tasks';
      case STORES.journal: return 'journals';
      default:             return null;
    }
  }

  async getUser() {
    if (this._sessionUser?.id) return this._sessionUser;
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || null;
    if (user) { this._sessionUser = user; return user; }
    if (await this.checkConnectivity()) {
      try {
        const { data: { user: remoteUser } } = await supabase.auth.getUser();
        if (remoteUser) this._sessionUser = remoteUser;
        return remoteUser || null;
      } catch { return null; }
    }
    return null;
  }

  _playerFromProfile(profile, user) {
    if (!user && !profile) return null;
    const id = profile?.id || user?.id || null;
    if (!id) return null;
    return {
      UUID:      id,
      accessKey: profile?.access_key ?? null,
      blocked:   profile?.blocked    ?? false,
      email:     user?.email         ?? null,
      hasAccess: !!(profile?.access_key) && !(profile?.blocked),
    };
  }

  async _getCachedSnapshotForUser(user) {
    if (!user) return { todos: [], tasks: [], journals: [], profile: null, player: null, lastSyncedAt: null, pendingSyncCount: 0 };
    const snapshot         = await getSnapshot(user.id);
    const pendingSyncCount = await getPendingCount(user.id);
    return {
      todos:    snapshot.todos    || [],
      tasks:    snapshot.tasks    || [],
      journals: snapshot.journals || [],
      profile:  snapshot.profile  || null,
      player:   this._playerFromProfile(snapshot.profile, user),
      lastSyncedAt: snapshot.lastSyncedAt || null,
      pendingSyncCount,
    };
  }

  async getCachedSnapshot() {
    const user = await this.getUser();
    return this._getCachedSnapshotForUser(user);
  }

  async _requirePremiumDataAccess() {
    const user = await this.getUser();
    if (!user) throw new Error('Not authenticated');
    const snapshot = await this._getCachedSnapshotForUser(user);
    if (!snapshot?.player?.hasAccess) throw new Error('Data import/export is available with full access only.');
    return { user, snapshot };
  }

  async _writeSnapshot(user, patch) {
    if (!user) return null;
    const snapshot = await updateSnapshot(user.id, current => ({ ...current, ...patch }));
    this._notifyLocalChange();
    return snapshot;
  }

  async _updateSnapshotCollection(user, store, updater) {
    if (!user) return null;
    const key = this._storeKey(store);
    if (!key) return null;
    const snapshot = await updateSnapshot(user.id, current => {
      const existing = Array.isArray(current[key]) ? current[key] : [];
      return { [key]: updater(existing) };
    });
    this._notifyLocalChange();
    return snapshot;
  }

  _normalizeStorePayload(store, data) {
    const allowedFields = STORE_FIELDS[store];
    if (!allowedFields) return { ...data };
    const normalized = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) normalized[key] = data[key];
    }
    if (data.uuid && !normalized.UUID) normalized.UUID = data.uuid;
    return normalized;
  }

  _applyOperationToRecords(records, operation) {
    if (!operation) return records;
    if (operation.type === 'delete') return records.filter(item => item.UUID !== operation.uuid);
    if (operation.type === 'upsert') {
      const payload = this._normalizeStorePayload(operation.store, operation.payload || {});
      const index   = records.findIndex(item => item.UUID === payload.UUID);
      if (index === -1) return [...records, payload];
      const next = [...records]; next[index] = { ...next[index], ...payload }; return next;
    }
    return records;
  }

  async _remoteFetchProfile(user) {
    let { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!profile) {
      const { data: newProfile, error: upsertError } = await supabase
        .from('profiles').upsert({ id: user.id, blocked: false }).select().single();
      if (upsertError) throw upsertError;
      profile = newProfile;
    }
    return profile;
  }

  async _remoteFetchTable(table, userId, orderBy = null) {
    let query = supabase.from(table).select('*').eq('user_id', userId);
    if (orderBy) query = query.order(orderBy, { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return fromRows(data);
  }

  async _remoteUpsert(store, data, user) {
    if (store === STORES.player) return;
    const table = TABLE[store];
    if (!table) throw new Error(`Unknown store: ${store}`);
    const payload = this._normalizeStorePayload(store, data);
    const row     = toRow({ ...payload });
    row.user_id   = user.id;
    if (row.UUID) { row.uuid = row.UUID; delete row.UUID; }

    // Supabase rejects empty strings for timestamp/date columns — convert to null.
    // This catches legacy records (e.g. completedAt: "") from older exports or
    // any code path that didn't explicitly set null.
    for (const key of Object.keys(row)) {
      if (row[key] === '') row[key] = null;
    }

    const { error } = await supabase.from(table).upsert(row, { onConflict: 'uuid' });
    if (error) throw error;
  }

  async _remoteDelete(store, UUID) {
    const table = TABLE[store];
    if (!table) return;
    const { error } = await supabase.from(table).delete().eq('uuid', UUID);
    if (error) throw error;
  }

  async _queueOperation(user, operation) {
    if (!user) return;
    await enqueueOperation(user.id, operation);
    this._notifyLocalChange();
  }

  _scheduleBackgroundFlush() {
    if (this._flushPromise) return;
    setTimeout(async () => {
      if (this._flushPromise) return;
      if (!(await this.checkConnectivity())) return;
      try { await this.flushPendingOperations(); } catch { /* retry later */ }
    }, 0);
  }

  async _flushPendingOperationsInternal() {
    const user = await this.getUser();
    if (!user || !(await this.checkConnectivity())) return { ok: false, pendingCount: 0, error: 'offline' };

    const queue     = await getQueuedOperations(user.id);
    let   lastError = null;

    for (const op of queue) {
      try {
        if (op.type === 'upsert') await this._remoteUpsert(op.store, op.payload, user);
        else if (op.type === 'delete') await this._remoteDelete(op.store, op.uuid);
        await removeQueuedOperation(op.id);
      } catch (error) {
        lastError = error;

        // Classify failure: permanent errors will NEVER succeed on retry and
        // must be removed so they don't block the queue indefinitely.
        //
        // PostgreSQL codes that indicate bad data or auth that won't change:
        //   22007 = invalid_datetime_format  (e.g. completedAt: "")
        //   42501 = insufficient_privilege   (RLS violation — wrong owner)
        //   23505 = unique_violation
        //   23502 = not_null_violation
        //   22P02 = invalid_text_representation
        const PERMANENT_PG_CODES = new Set(['22007', '42501', '23505', '23502', '22P02']);
        const isPermanent = PERMANENT_PG_CODES.has(error?.code);

        if (isPermanent) {
          console.warn('Dropping permanently-failing queued op', op.id, error?.code, error?.message);
          await removeQueuedOperation(op.id).catch(() => {});
        } else {
          // Retryable (network error, 5xx, unknown) — keep in queue, try next sync
          console.error('Sync failed for queued op (will retry):', op.id, error);
        }
        // Always continue — don't let one failure stop the rest
      }
    }

    const remaining = await getQueuedOperations(user.id);
    await updateSnapshot(user.id, current => ({
      ...current,
      lastSyncedAt:  !lastError && remaining.length === 0 ? new Date().toISOString() : current.lastSyncedAt,
      lastSyncError: lastError ? (lastError.message || String(lastError)) : null,
    }));
    this._notifyLocalChange();
    return { ok: !lastError && remaining.length === 0, pendingCount: remaining.length, error: lastError };
  }

  async flushPendingOperations() {
    if (this._flushPromise) return this._flushPromise;
    this._flushPromise = this._flushPendingOperationsInternal().finally(() => { this._flushPromise = null; });
    return this._flushPromise;
  }

  async syncData() {
    const user = await this.getUser();
    if (!user)                              return this.getCachedSnapshot();
    if (!(await this.checkConnectivity()))  return this.getCachedSnapshot();

    const flushResult = await this.flushPendingOperations();
    // Don't bail if some ops failed — still fetch fresh server data so the
    // snapshot reflects the latest state. Remaining pending ops will retry
    // on the next sync cycle.

    const [rawProfile, todos, tasks, journals] = await Promise.all([
      this._remoteFetchProfile(user),
      this._remoteFetchTable('todos',    user.id),
      this._remoteFetchTable('tasks',    user.id, 'created_at'),
      this._remoteFetchTable('journals', user.id, 'created_at'),
    ]);

    // Issue 6 fix: verify the access key in this profile still belongs to THIS
    // user. If another account claimed it, clear access on this side immediately.
    let profile = rawProfile;
    if (profile?.access_key) {
      const { data: keyOwner } = await supabase
        .from('profiles')
        .select('id')
        .eq('access_key', profile.access_key)
        .maybeSingle();
      if (!keyOwner || keyOwner.id !== user.id) {
        // Key was transferred — strip it locally and update DB
        await supabase.from('profiles').update({ access_key: null }).eq('id', user.id);
        profile = { ...profile, access_key: null };
      }
    }

    await this._writeSnapshot(user, { profile, todos, tasks, journals, lastSyncedAt: new Date().toISOString(), lastSyncError: null });
    return this.getCachedSnapshot();
  }

  async getOrCreatePlayer() {
    const user = await this.getUser();
    if (!user) return null;
    if (await this.checkConnectivity()) {
      try {
        const profile = await this._remoteFetchProfile(user);
        await this._writeSnapshot(user, { profile });
        return this._playerFromProfile(profile, user);
      } catch { /* fall through to cache */ }
    }
    const snapshot = await this._getCachedSnapshotForUser(user);
    return snapshot.player || this._playerFromProfile(null, user);
  }

  async claimAccessKey(key) {
    if (!(await this.checkConnectivity({ force: true }))) {
      return { success: false, error: 'You are offline. Reconnect to activate an access key.' };
    }
    const { data, error } = await supabase.rpc('claim_access_key', { p_key: key });
    if (error) return { success: false, error: error.message };
    await this.syncData();
    return data;
  }

  async releaseAccessKey() {
    if (!(await this.checkConnectivity({ force: true }))) {
      return { success: false, error: 'You are offline. Connect to downgrade.' };
    }
    const user = await this.getUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    const { error } = await supabase.from('profiles').update({ access_key: null }).eq('id', user.id);
    if (error) return { success: false, error: error.message };
    await this.syncData();
    return { success: true };
  }

  async add(store, data) {
    const user = await this.getUser();
    if (!user) throw new Error('Not authenticated');
    if (store === STORES.player) return;
    const normalized = this._normalizeStorePayload(store, data);

    // Sanitize empty strings for timestamp fields before storing locally and
    // queuing for sync — prevents Supabase rejecting ops with "" timestamps.
    for (const key of Object.keys(normalized)) {
      if (normalized[key] === '') normalized[key] = null;
    }
    await this._updateSnapshotCollection(user, store, existing => {
      const index = existing.findIndex(item => item.UUID === normalized.UUID);
      if (index === -1) return [...existing, normalized];
      const next = [...existing]; next[index] = { ...next[index], ...normalized }; return next;
    });
    await this._queueOperation(user, { type: 'upsert', store, payload: normalized });
    this._scheduleBackgroundFlush();
    return normalized;
  }

  async get(store, UUID) {
    const snapshot = await this.getCachedSnapshot();
    const key      = this._storeKey(store);
    if (!key) return null;
    return (snapshot[key] || []).find(item => item.UUID === UUID) || null;
  }

  async remove(store, UUID) {
    const user = await this.getUser();
    if (!user) return;
    await this._updateSnapshotCollection(user, store, existing => existing.filter(item => item.UUID !== UUID));
    await this._queueOperation(user, { type: 'delete', store, uuid: UUID });
    this._scheduleBackgroundFlush();
  }

  async getAll(store) {
    const snapshot = await this.getCachedSnapshot();
    const key      = this._storeKey(store);
    return key ? (snapshot[key] || []) : [];
  }

  async getPlayerStore(store, _playerUUID) { return this.getAll(store); }

  async getTreeNodes(treeId) {
    const todos = await this.getAll(STORES.todo);
    return todos.filter(todo => todo.treeId === treeId);
  }

  async getPlayerTrees(_playerUUID) {
    const todos = await this.getAll(STORES.todo);
    return todos.filter(todo => todo.isRoot);
  }

  async getAllJournals() { return this.getAll(STORES.journal); }
  async getAllTasks()    { return this.getAll(STORES.task);    }

  async getDataAsJSON() {
    await this._requirePremiumDataAccess();
    const [todos, tasks, journals] = await Promise.all([
      this.getAll(STORES.todo), this.getAll(STORES.task), this.getAll(STORES.journal),
    ]);
    const blob = new Blob([JSON.stringify({ todos, tasks, journals }, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'canopy-data.json'; a.click();
    URL.revokeObjectURL(url);
  }
}

export default SupabaseConnection;