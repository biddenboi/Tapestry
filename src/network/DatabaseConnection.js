import { DATABASE_VERSION, STORES } from '../utils/Constants.js';
import { addDurationToDate, getMidnightOfDate } from '../utils/Helpers/Time.js';

function getStore(instance, storeName, event) {
  if (event?.oldVersion != null && event.oldVersion < DATABASE_VERSION) {
    return event.target.transaction.objectStore(storeName);
  }
  return instance.database.transaction(storeName, 'readonly').objectStore(storeName);
}

class DatabaseConnection {
  database = null;

  isCompatable() {
    return window.indexedDB;
  }

  createStore(name, keyPath, indexes, event) {
    const store = this.database.objectStoreNames.contains(name)
      ? event.target.transaction.objectStore(name)
      : this.database.createObjectStore(name, { keyPath });

    indexes.forEach(([indexName, keyPathValue, options = { unique: false }]) => {
      if (!store.indexNames.contains(indexName)) {
        store.createIndex(indexName, keyPathValue, options);
      }
    });

    return store;
  }

  async handleVersionUpgrades(event) {
    this.database = event.target.result;
    const oldVersion = event.oldVersion;

    if (DATABASE_VERSION >= 1 && oldVersion < 1) {
      this.createStore(STORES.task, 'UUID', [
        ['createdAt', 'createdAt'],
        ['parent', 'parent'],
        ['efficiency', 'efficiency'],
        ['estimatedDuration', 'estimatedDuration'],
        ['location', 'location'],
        ['points', 'points'],
        ['name', 'name'],
        ['completedAt', 'completedAt'],
      ], event);

      this.createStore(STORES.journal, 'UUID', [
        ['createdAt', 'createdAt'],
        ['title', 'title'],
        ['entry', 'entry'],
        ['parent', 'parent'],
      ], event);

      this.createStore(STORES.player, 'UUID', [
        ['username', 'username'],
        ['createdAt', 'createdAt'],
        ['description', 'description'],
        ['tokens', 'tokens'],
        ['wakeTime', 'wakeTime'],
        ['sleepTime', 'sleepTime'],
        ['minutesClearedToday', 'minutesClearedToday'],
        ['elo', 'elo'],
      ], event);

      this.createStore(STORES.event, 'UUID', [
        ['type', 'type'],
        ['description', 'description'],
        ['createdAt', 'createdAt'],
        ['parent', 'parent'],
      ], event);

      this.createStore(STORES.shop, 'UUID', [
        ['name', 'name'],
        ['description', 'description'],
        ['type', 'type'],
        ['category', 'category'],
        ['enjoyment', 'enjoyment'],
      ], event);

      this.createStore(STORES.todo, 'UUID', [
        ['dueDate', 'dueDate'],
        ['efficiency', 'efficiency'],
        ['estimatedDuration', 'estimatedDuration'],
        ['name', 'name'],
      ], event);

      this.createStore(STORES.transaction, 'UUID', [
        ['name', 'name'],
        ['createdAt', 'createdAt'],
        ['completedAt', 'completedAt'],
        ['cost', 'cost'],
        ['duration', 'duration'],
        ['location', 'location'],
        ['parent', 'parent'],
      ], event);
    }

    if (DATABASE_VERSION >= 2 && oldVersion < 2) {
      this.createStore(STORES.inventory, 'UUID', [
        ['parent', 'parent'],
        ['itemUUID', 'itemUUID'],
        ['name', 'name'],
        ['type', 'type'],
        ['quantity', 'quantity'],
      ], event);
    }

    if (DATABASE_VERSION >= 3 && oldVersion < 3) {
      this.createStore(STORES.match, 'UUID', [
        ['createdAt', 'createdAt'],
        ['status', 'status'],
        ['parent', 'parent'],
      ], event);
    }

    if (DATABASE_VERSION >= 4 && oldVersion < 4) {
      this.createStore(STORES.friendship, 'UUID', [
        ['createdAt', 'createdAt'],
        ['status', 'status'],
        ['players', 'players', { unique: false, multiEntry: true }],
      ], event);

      this.createStore(STORES.notification, 'UUID', [
        ['createdAt', 'createdAt'],
        ['parent', 'parent'],
        ['readAt', 'readAt'],
      ], event);
    }

    if (DATABASE_VERSION >= 5 && oldVersion < 5) {
      const todoStore = event.target.transaction.objectStore(STORES.todo);
      if (!todoStore.indexNames.contains('parent')) {
        todoStore.createIndex('parent', 'parent', { unique: false });
      }
    }

    if (DATABASE_VERSION >= 6 && oldVersion < 6) {
      this.createStore(STORES.chatMessage, 'UUID', [
        ['createdAt', 'createdAt'],
        ['playerUUID', 'playerUUID'],
      ], event);
    }

    if (DATABASE_VERSION >= 7 && oldVersion < 7) {
      this.createStore(STORES.journalComment, 'UUID', [
        ['createdAt', 'createdAt'],
        ['journalUUID', 'journalUUID'],
        ['authorUUID', 'authorUUID'],
      ], event);
    }

    if (DATABASE_VERSION >= 8 && oldVersion < 8) {
      this.createStore(STORES.notes, 'UUID', [
        ['createdAt', 'createdAt'],
        ['updatedAt', 'updatedAt'],
      ], event);
    }

    if (DATABASE_VERSION >= 9 && oldVersion < 9) {
      this.createStore(STORES.project, 'UUID', [
        ['name', 'name'],
        ['createdAt', 'createdAt'],
        ['parent', 'parent'],
      ], event);

      const todoStore = event.target.transaction.objectStore(STORES.todo);
      if (!todoStore.indexNames.contains('aversion')) {
        todoStore.createIndex('aversion', 'aversion', { unique: false });
      }
      if (!todoStore.indexNames.contains('projectId')) {
        todoStore.createIndex('projectId', 'projectId', { unique: false });
      }

      todoStore.openCursor().onsuccess = (cursorEvent) => {
        const cursor = cursorEvent.target.result;
        if (!cursor) return;
        const todo = cursor.value;
        if (todo.sessionDuration != null && Number.isFinite(Number(todo.sessionDuration))) {
          const minutes = Number(todo.sessionDuration);
          if (minutes < 86400000) {
            cursor.update({ ...todo, sessionDuration: minutes * 60000 });
          }
        }
        cursor.continue();
      };
    }

    if (DATABASE_VERSION >= 10 && oldVersion < 10) {
      this.createStore(STORES.customEvent, 'UUID', [
        ['type', 'type'],
        ['specialKind', 'specialKind'],
        ['createdAt', 'createdAt'],
      ], event);

      this.createStore(STORES.eventLog, 'UUID', [
        ['parent', 'parent'],
        ['eventUUID', 'eventUUID'],
        ['igtDay', 'igtDay'],
        ['loggedAt', 'loggedAt'],
        ['specialKind', 'specialKind'],
      ], event);

      this.createStore(STORES.eventBuff, 'UUID', [
        ['parent', 'parent'],
        ['eventUUID', 'eventUUID'],
        ['expiresAt', 'expiresAt'],
        ['appliedAt', 'appliedAt'],
      ], event);
    }
  }

  constructor() {
    if (!this.isCompatable()) {
      throw new Error('Browser incompatibility with IndexedDB.');
    }

    this.ready = new Promise((resolve, reject) => {
      const request = window.indexedDB.open('CheckpointDatabase', DATABASE_VERSION);
      request.onerror = (event) => reject(event.target.error || request.error);
      request.onupgradeneeded = async (event) => {
        await this.handleVersionUpgrades(event);
      };
      request.onsuccess = (event) => {
        this.database = event.target.result;
        // Resolve ready FIRST so that seedSpecialEvents (which calls
        // await this.ready internally) doesn't deadlock waiting on itself.
        resolve();
        // Seed the three system events. Idempotent — safe to call on every boot.
        this.seedSpecialEvents().catch(() => undefined);
      };
    });
  }

  downloadJSON(data, filename) {
    const json = JSON.stringify(data, (key, value) => (value == null || value === '' ? undefined : value));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  getPendingProfilePatchesStorageKey() {
    return 'tapestry_pending_profile_patches';
  }

  loadPendingProfilePatches() {
    try {
      const raw = localStorage.getItem(this.getPendingProfilePatchesStorageKey());
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  savePendingProfilePatches(profilePatches) {
    const hasEntries = Object.values(profilePatches || {}).some((entries) => (entries || []).length > 0);
    if (!hasEntries) {
      localStorage.removeItem(this.getPendingProfilePatchesStorageKey());
      return;
    }
    localStorage.setItem(this.getPendingProfilePatchesStorageKey(), JSON.stringify(profilePatches));
  }

  clearPendingProfilePatches() {
    localStorage.removeItem(this.getPendingProfilePatchesStorageKey());
  }

  getProfileOnlyKeys() {
    return new Set([
      'username',
      'displayName',
      'profilePicture',
      'bannerPicture',
      'avatar',
      'avatarUrl',
      'bannerUrl',
    ]);
  }

  isEmbeddedImageData(value) {
    return typeof value === 'string' && value.startsWith('data:image/');
  }

  extractProfilePatchDeep(value) {
    const PROFILE_ONLY_KEYS = this.getProfileOnlyKeys();

    if (this.isEmbeddedImageData(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      const extracted = value.map((entry) => this.extractProfilePatchDeep(entry));
      return extracted.some((entry) => entry !== undefined) ? extracted : undefined;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const result = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      if (PROFILE_ONLY_KEYS.has(key) || this.isEmbeddedImageData(entryValue)) {
        if (entryValue !== undefined && entryValue !== '') {
          result[key] = entryValue;
        }
        return;
      }

      const extractedValue = this.extractProfilePatchDeep(entryValue);
      if (extractedValue !== undefined) {
        result[key] = extractedValue;
      }
    });

    return Object.keys(result).length ? result : undefined;
  }

  stripProfilePatchDeep(value) {
    const PROFILE_ONLY_KEYS = this.getProfileOnlyKeys();

    if (this.isEmbeddedImageData(value)) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.stripProfilePatchDeep(entry));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const result = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      if (PROFILE_ONLY_KEYS.has(key)) return;
      const cleanedValue = this.stripProfilePatchDeep(entryValue);
      if (cleanedValue !== undefined && cleanedValue !== '') {
        result[key] = cleanedValue;
      }
    });
    return result;
  }

  deepMergeProfilePatch(target, patch) {
    if (patch === undefined) return target;

    if (Array.isArray(patch)) {
      const base = Array.isArray(target) ? [...target] : [];
      patch.forEach((patchEntry, index) => {
        if (patchEntry === undefined) return;
        base[index] = this.deepMergeProfilePatch(base[index], patchEntry);
      });
      return base;
    }

    if (!patch || typeof patch !== 'object') {
      return patch;
    }

    const base = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
    Object.entries(patch).forEach(([key, patchValue]) => {
      base[key] = this.deepMergeProfilePatch(base[key], patchValue);
    });
    return base;
  }

  getDataStoreMapping() {
    return {
      tasks: STORES.task,
      journals: STORES.journal,
      events: STORES.event,
      shop: STORES.shop,
      todos: STORES.todo,
      transactions: STORES.transaction,
      inventory: STORES.inventory,
      matches: STORES.match,
      friendships: STORES.friendship,
      notifications: STORES.notification,
      chatMessages: STORES.chatMessage,
      journalComments: STORES.journalComment,
      projects: STORES.project,
      notes: STORES.notes,
      eventLogs: STORES.eventLog,
    };
  }

  async getDataPayload() {
    await this.ready;
    const [tasks, journals, events, shop, todos, transactions, inventory, matches, friendships, notifications, chatMessages, journalComments, projects, notes, eventLogs] = await Promise.all([
      this.getAll(STORES.task),
      this.getAll(STORES.journal),
      this.getAll(STORES.event),
      this.getAll(STORES.shop),
      this.getAll(STORES.todo),
      this.getAll(STORES.transaction),
      this.getAll(STORES.inventory),
      this.getAll(STORES.match),
      this.getAll(STORES.friendship),
      this.getAll(STORES.notification),
      this.getAll(STORES.chatMessage),
      this.getAll(STORES.journalComment),
      this.getAll(STORES.project),
      this.getAll(STORES.notes),
      this.getAll(STORES.eventLog),
    ]);

    return {
      tasks,
      journals,
      events,
      shop,
      todos,
      transactions,
      inventory,
      matches,
      friendships,
      notifications,
      chatMessages,
      journalComments,
      projects,
      notes,
      eventLogs,
    };
  }

  buildProfilePatches(dataPayload) {
    const profilePatches = {};
    Object.entries(dataPayload).forEach(([key, entries]) => {
      const storePatches = (entries || [])
        .map((entry) => {
          const patch = this.extractProfilePatchDeep(entry);
          return patch ? { UUID: entry.UUID, patch } : null;
        })
        .filter(Boolean);

      if (storePatches.length) {
        profilePatches[key] = storePatches;
      }
    });
    return profilePatches;
  }

  async applyProfilePatches(profilePatches = {}) {
    const mapping = this.getDataStoreMapping();
    const remainingPatches = {};

    for (const [key, patches] of Object.entries(profilePatches)) {
      const storeName = mapping[key];
      if (!storeName) continue;

      for (const patchEntry of patches || []) {
        const recordUUID = patchEntry?.UUID;
        if (!recordUUID) continue;

        const existingRecord = await this.get(storeName, recordUUID);
        if (!existingRecord) {
          if (!remainingPatches[key]) remainingPatches[key] = [];
          remainingPatches[key].push(patchEntry);
          continue;
        }

        const mergedRecord = this.deepMergeProfilePatch(existingRecord, patchEntry.patch);
        await this.add(storeName, mergedRecord);
      }
    }

    return remainingPatches;
  }

  async getProfilesAsJSON() {
    await this.ready;
    const players = await this.getAll(STORES.player);
    const dataPayload = await this.getDataPayload();
    const profilePatches = this.buildProfilePatches(dataPayload);
    this.downloadJSON({ players, profilePatches }, 'tapestry-profiles.json');
  }

  /**
   * "Customization" bundle: visual identity (player profiles + their banners
   * and patches) + event definitions (custom events, including their banner
   * images encoded as data URLs). This is what the user sees as "Download
   * Customization" — everything that defines how the app *looks and feels*
   * for this human, separate from their activity history.
   */
  async getCustomizationAsJSON() {
    await this.ready;
    const players = await this.getAll(STORES.player);
    const dataPayload = await this.getDataPayload();
    const profilePatches = this.buildProfilePatches(dataPayload);
    const customEvents = await this.getAll(STORES.customEvent);
    this.downloadJSON(
      { players, profilePatches, customEvents },
      'tapestry-customization.json'
    );
  }

  /**
   * Restore the customization bundle. Players are replaced wholesale (same
   * as the legacy profileUpload). Custom events are MERGED — existing events
   * with matching UUIDs get overwritten (so banner edits propagate), but
   * locally-created events that aren't in the import are preserved.
   */
  async customizationUpload(fileContents) {
    const data = JSON.parse(fileContents);

    await this.clear(STORES.player).catch(() => undefined);
    for (const entry of data.players || []) {
      // eslint-disable-next-line no-await-in-loop
      await this.add(STORES.player, entry);
    }

    const pending = this.loadPendingProfilePatches();
    const mergedPatches = { ...pending };
    Object.entries(data.profilePatches || {}).forEach(([key, entries]) => {
      mergedPatches[key] = [...(mergedPatches[key] || []), ...(entries || [])];
    });
    const remainingPatches = await this.applyProfilePatches(mergedPatches);
    this.savePendingProfilePatches(remainingPatches);

    // Merge-import custom events (don't wipe — preserve local additions).
    for (const evt of data.customEvents || []) {
      // eslint-disable-next-line no-await-in-loop
      await this.add(STORES.customEvent, evt);
    }
    // Re-seed in case the bundle didn't include the system three.
    await this.seedSpecialEvents().catch(() => undefined);
  }

  async getDataAsJSON() {
    await this.ready;
    const dataPayload = await this.getDataPayload();
    const strippedData = this.stripProfilePatchDeep(dataPayload);
    this.downloadJSON(strippedData, 'tapestry-data.json');
  }

  async profileUpload(fileContents) {
    const data = JSON.parse(fileContents);

    await this.clear(STORES.player).catch(() => undefined);
    for (const entry of data.players || []) {
      await this.add(STORES.player, entry);
    }

    const pending = this.loadPendingProfilePatches();
    const mergedPatches = { ...pending };
    Object.entries(data.profilePatches || {}).forEach(([key, entries]) => {
      mergedPatches[key] = [...(mergedPatches[key] || []), ...(entries || [])];
    });

    const remainingPatches = await this.applyProfilePatches(mergedPatches);
    this.savePendingProfilePatches(remainingPatches);
  }

  async dataUpload(fileContents) {
    const data = JSON.parse(fileContents);
    const isLegacy = 'players' in data;

    const dataStores = [
      STORES.task, STORES.journal, STORES.event, STORES.shop,
      STORES.todo, STORES.transaction, STORES.inventory, STORES.match,
      STORES.friendship, STORES.notification, STORES.chatMessage,
      STORES.journalComment, STORES.project, STORES.notes, STORES.eventLog,
    ];

    for (const storeName of dataStores) {
      await this.clear(storeName).catch(() => undefined);
    }
    if (isLegacy) {
      await this.clear(STORES.player).catch(() => undefined);
      this.clearPendingProfilePatches();
    }

    const mapping = {
      tasks: STORES.task,
      journals: STORES.journal,
      events: STORES.event,
      shop: STORES.shop,
      todos: STORES.todo,
      transactions: STORES.transaction,
      inventory: STORES.inventory,
      matches: STORES.match,
      friendships: STORES.friendship,
      notifications: STORES.notification,
      chatMessages: STORES.chatMessage,
      journalComments: STORES.journalComment,
      projects: STORES.project,
      notes: STORES.notes,
      eventLogs: STORES.eventLog,
    };

    if (isLegacy) {
      mapping.players = STORES.player;
    }

    for (const [key, storeName] of Object.entries(mapping)) {
      for (const entry of data[key] || []) {
        await this.add(storeName, entry);
      }
    }

    if (!isLegacy) {
      const remainingPatches = await this.applyProfilePatches(this.loadPendingProfilePatches());
      this.savePendingProfilePatches(remainingPatches);
    }
  }

  async getRelativePlayerStore(store, player) {
    const dateMS = new Date().getTime();
    const dateMidnightMS = getMidnightOfDate(new Date()).getTime();
    const msElapsed = dateMS - dateMidnightMS;
    const startDate = 0;
    const endDate = addDurationToDate(new Date(startDate), msElapsed).toISOString();
    const values = await this.getStoreFromRange(store, startDate, endDate);
    return values.filter((entry) => entry.parent === player.UUID);
  }

  async getStoreFromRange(store, startDate, endDate) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readonly');
      const objectStore = transaction.objectStore(store);
      const index = store === STORES.task && objectStore.indexNames.contains('completedAt')
        ? objectStore.index('completedAt')
        : objectStore.index('createdAt');
      const dateRange = IDBKeyRange.bound(startDate, endDate, false, false);
      const results = [];
      index.openCursor(dateRange).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getPlayerStore(store, UUID) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readonly');
      const objectStore = transaction.objectStore(store);
      if (!objectStore.indexNames.contains('parent')) {
        resolve([]);
        return;
      }
      const request = objectStore.index('parent').getAll(UUID);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ── Global (cross-profile) money ──────────────────────────────────────
  // Dollars are intentionally NOT per-profile: balances persist across all
  // profiles and are never reset when a new profile is created.
  getGlobalMoney() {
    const raw = localStorage.getItem('tapestry_global_money');
    const val = parseFloat(raw);
    return Number.isFinite(val) ? val : 0;
  }

  setGlobalMoney(amount) {
    const val = Math.max(0, Number.isFinite(Number(amount)) ? Number(amount) : 0);
    localStorage.setItem('tapestry_global_money', String(val));
    return val;
  }

  getActivePlayerUUID() {
    return localStorage.getItem('tapestry_active_profile_uuid') || null;
  }

  setActivePlayerUUID(uuid) {
    if (uuid) {
      localStorage.setItem('tapestry_active_profile_uuid', uuid);
    } else {
      localStorage.removeItem('tapestry_active_profile_uuid');
    }
  }

  async getCurrentPlayer() {
    await this.ready;
    const activeUUID = this.getActivePlayerUUID();
    if (activeUUID) {
      const player = await this.get(STORES.player, activeUUID);
      if (player && !this.isLegacyBootstrapPlayer(player)) return player;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.player, 'readonly');
      const objectStore = transaction.objectStore(STORES.player);
      const request = objectStore.index('createdAt').openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { resolve(null); return; }
        if (this.isLegacyBootstrapPlayer(cursor.value)) { cursor.continue(); return; }
        this.setActivePlayerUUID(cursor.value.UUID);
        resolve(cursor.value);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async switchProfile(fromPlayer, toPlayerUUID) {
    const now = new Date().toISOString();
    if (fromPlayer) {
      const start = fromPlayer.utcTimeAtStart ? new Date(fromPlayer.utcTimeAtStart).getTime() : Date.now();
      const accumulated = (fromPlayer.inGameTime || 0) + (Date.now() - start);
      await this.add(STORES.player, { ...fromPlayer, inGameTime: accumulated, utcTimeAtStart: null });
    }
    const toPlayer = await this.get(STORES.player, toPlayerUUID);
    if (toPlayer) {
      await this.add(STORES.player, { ...toPlayer, utcTimeAtStart: now });
    }
    this.setActivePlayerUUID(toPlayerUUID);
  }

  async createAndSwitchProfile(fromPlayer, newPlayerData) {
    const now = new Date().toISOString();
    if (fromPlayer) {
      const start = fromPlayer.utcTimeAtStart ? new Date(fromPlayer.utcTimeAtStart).getTime() : Date.now();
      const accumulated = (fromPlayer.inGameTime || 0) + (Date.now() - start);
      await this.add(STORES.player, { ...fromPlayer, inGameTime: accumulated, utcTimeAtStart: null });
    }
    const newPlayer = { ...newPlayerData, elo: 0, inGameTime: 0, utcTimeAtStart: now, createdAt: now };
    await this.add(STORES.player, newPlayer);
    this.setActivePlayerUUID(newPlayer.UUID);
    return newPlayer;
  }

  /**
   * Permanently wipe a profile and ALL associated timeline data. Used by the
   * Ban tool. This is a one-shot, no-undo operation: the player record is
   * removed along with every record across every store that references that
   * player UUID (via `parent`, `playerUUID`, `authorUUID`, `players` index, or
   * by cascading from the player's own journals into journalComments).
   *
   * Stores left untouched on purpose:
   *   • shop   — catalog data, shared globally
   *   • notes  — quick notes are not profile-scoped
   *   • customEvent — user-created event TYPES, shared across profiles
   *
   * After completion, the active profile UUID is cleared. The next call to
   * getCurrentPlayer() will fall back to the most-recently-created profile or
   * trigger the new-profile flow if none remain.
   */
  async wipeProfile(playerUUID) {
    if (!playerUUID) return;
    await this.ready;

    // Helper: delete every record in `store` whose value of `field` === target
    const deleteByField = (store, field, target) => new Promise((resolve, reject) => {
      const tx = this.database.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const useIndex = os.indexNames.contains(field);
      const cursorReq = useIndex ? os.index(field).openCursor(IDBKeyRange.only(target)) : os.openCursor();
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (useIndex || cursor.value?.[field] === target) {
          cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror   = () => reject(tx.error);
      tx.onabort   = () => reject(tx.error);
    });

    // Helper: delete every record in `store` whose key value is in the supplied set
    const deleteByFieldInSet = (store, field, set) => new Promise((resolve, reject) => {
      if (!set || set.size === 0) { resolve(); return; }
      const tx = this.database.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      os.openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (set.has(cursor.value?.[field])) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror   = () => reject(tx.error);
      tx.onabort   = () => reject(tx.error);
    });

    // 1. Snapshot the player's journal UUIDs so we can cascade-delete the
    //    comments attached to them BEFORE the journals themselves are gone.
    const ownedJournals = await this.getPlayerStore(STORES.journal, playerUUID);
    const journalUUIDs = new Set((ownedJournals || []).map((j) => j.UUID).filter(Boolean));

    // 2. Cascade: delete every comment on any of this player's journals,
    //    regardless of who authored the comment.
    if (journalUUIDs.size > 0) {
      await deleteByFieldInSet(STORES.journalComment, 'journalUUID', journalUUIDs);
    }
    // Also delete every comment authored BY this player on anyone's journal.
    await deleteByField(STORES.journalComment, 'authorUUID', playerUUID);

    // 3. Delete every store keyed by `parent` === playerUUID.
    const parentScopedStores = [
      STORES.task,
      STORES.journal,
      STORES.event,
      STORES.todo,
      STORES.transaction,
      STORES.inventory,
      STORES.match,
      STORES.notification,
      STORES.project,
      STORES.eventLog,
      STORES.eventBuff,
    ];
    for (const store of parentScopedStores) {
      try { await deleteByField(store, 'parent', playerUUID); }
      catch (err) { console.warn(`[wipeProfile] failed to wipe ${store}:`, err); }
    }

    // 4. Chat messages are keyed by `playerUUID` (the message author).
    try { await deleteByField(STORES.chatMessage, 'playerUUID', playerUUID); }
    catch (err) { console.warn('[wipeProfile] failed to wipe chatMessages:', err); }

    // 5. Friendships use a multiEntry `players` index. The cursor read of the
    //    record gives us the array — drop the row if it contains our UUID.
    try {
      await new Promise((resolve, reject) => {
        const tx = this.database.transaction(STORES.friendship, 'readwrite');
        tx.objectStore(STORES.friendship).openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          const players = Array.isArray(cursor.value?.players) ? cursor.value.players : [];
          if (players.includes(playerUUID)) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror   = () => reject(tx.error);
        tx.onabort   = () => reject(tx.error);
      });
    } catch (err) { console.warn('[wipeProfile] failed to wipe friendships:', err); }

    // 6. The player record itself.
    try { await this.remove(STORES.player, playerUUID); }
    catch (err) { console.warn('[wipeProfile] failed to remove player:', err); }

    // 7. Clean up any per-profile localStorage breadcrumbs (EOD choices, wake
    //    pending flags, pending profile patches). We sweep the whole keyspace
    //    once because keys are date-suffixed.
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
          key.startsWith(`tapestry_eod_${playerUUID}_`) ||
          key.startsWith(`tapestry_wake_pending_${playerUUID}_`)
        ) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (err) { console.warn('[wipeProfile] failed to sweep localStorage:', err); }

    // 8. If the wiped profile was the active one, clear the pointer. The next
    //    getCurrentPlayer() call will pick a remaining profile (or none).
    if (this.getActivePlayerUUID() === playerUUID) {
      this.setActivePlayerUUID(null);
    }
  }

  async getChatMessages(currentPlayerIGT = Infinity, limit = 100) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.chatMessage, 'readonly');
      const objectStore = transaction.objectStore(STORES.chatMessage);
      const all = [];
      objectStore.index('createdAt').openCursor(null, 'prev').onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          all.push(cursor.value);
          cursor.continue();
        } else {
          const filtered = all
            .filter((msg) => (msg.inGameTimestamp || 0) <= currentPlayerIGT)
            .slice(0, limit)
            .reverse();
          resolve(filtered);
        }
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async sendChatMessage({ playerUUID, username, profilePicture, message, inGameTimestamp }) {
    const entry = {
      UUID: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      playerUUID,
      username,
      profilePicture: profilePicture || null,
      message,
      inGameTimestamp: inGameTimestamp || 0,
      createdAt: new Date().toISOString(),
    };
    await this.add(STORES.chatMessage, entry);
    return entry;
  }

  async markNotificationRead(notifUUID) {
    await this.ready;
    const notif = await this.get(STORES.notification, notifUUID);
    if (notif) {
      await this.add(STORES.notification, { ...notif, readAt: new Date().toISOString() });
    }
  }

  async getPendingFriendRequestsForPlayer(playerUUID) {
    const friendships = await this.getFriendshipsForPlayer(playerUUID);
    return friendships.filter(
      (f) => f.status === 'pending' && f.requestedBy !== playerUUID
    );
  }

  async getUnreadFriendRequestCount(playerUUID, currentPlayerIGT = Infinity) {
    await this.ready;
    const notifs = await this.getNotificationsForPlayer(playerUUID, currentPlayerIGT);
    return notifs.filter((n) => n.kind === 'friend_request' && !n.readAt).length;
  }

  isLegacyBootstrapPlayer(player) {
    if (!player) return false;
    return player.username === 'Agent'
      && player.description === 'A fresh challenger enters the hub.'
      && Number(player.tokens || 0) === 0
      && Number(player.minutesClearedToday || 0) === 0
      && Number(player.elo || 0) === 1000;
  }

  async getAllPlayers({ includeArchived = true } = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.player, 'readonly');
      const objectStore = transaction.objectStore(STORES.player);
      const results = [];
      objectStore.index('createdAt').openCursor(null, 'prev').onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (!this.isLegacyBootstrapPlayer(cursor.value)) {
            if (includeArchived || !cursor.value.archivedAt) {
              results.push(cursor.value);
            }
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getActivePlayers() {
    return this.getAllPlayers({ includeArchived: false });
  }

  async getCommentsForJournal(journalUUID) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.journalComment, 'readonly');
      const objectStore = transaction.objectStore(STORES.journalComment);
      if (!objectStore.indexNames.contains('journalUUID')) {
        resolve([]);
        return;
      }
      const request = objectStore.index('journalUUID').getAll(journalUUID);
      request.onsuccess = () => {
        const sorted = (request.result || [])
          .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        resolve(sorted);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getMatchesForPlayer(playerUUID) {
    return this.getPlayerStore(STORES.match, playerUUID);
  }

  async getFriendshipsForPlayer(playerUUID) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.friendship, 'readonly');
      const objectStore = transaction.objectStore(STORES.friendship);
      const request = objectStore.index('players').getAll(playerUUID);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getNotificationsForPlayer(playerUUID, currentPlayerIGT = Infinity) {
    const all = await this.getPlayerStore(STORES.notification, playerUUID);
    if (currentPlayerIGT === Infinity) return all;
    return all.filter((n) => (n.inGameTimestamp || 0) <= currentPlayerIGT);
  }

  async searchPlayers(query) {
    const allPlayers = await this.getAllPlayers();
    const q = String(query || '').trim().toLowerCase();
    if (!q) return allPlayers;
    return allPlayers.filter((player) => {
      const username = String(player.username || '').toLowerCase();
      const description = String(player.description || '').toLowerCase();
      return username.includes(q) || description.includes(q);
    });
  }

  async get(store, UUID) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readonly');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(UUID);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async add(store, data) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async remove(store, UUID) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.delete(UUID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(store) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllKeys(store) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readonly');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(store) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, 'readonly');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ── Custom events / logs / buffs ─────────────────────────────────────
  async getAllCustomEvents() {
    return this.getAll(STORES.customEvent);
  }

  async getEventLogsForPlayerEvent(playerUUID, eventUUID) {
    if (!playerUUID || !eventUUID) return [];
    const all = await this.getPlayerStore(STORES.eventLog, playerUUID);
    return all.filter((entry) => entry.eventUUID === eventUUID);
  }

  async getAllEventLogsForPlayer(playerUUID) {
    if (!playerUUID) return [];
    return this.getPlayerStore(STORES.eventLog, playerUUID);
  }

  /** Cross-profile: every event log in the database, regardless of parent. */
  async getAllEventLogs() {
    return this.getAll(STORES.eventLog);
  }

  async getEventLogsForEvent(eventUUID) {
    if (!eventUUID) return [];
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.eventLog, 'readonly');
      const objectStore = transaction.objectStore(STORES.eventLog);
      if (!objectStore.indexNames.contains('eventUUID')) {
        resolve([]);
        return;
      }
      const request = objectStore.index('eventUUID').getAll(eventUUID);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getActiveEventBuffsForPlayer(playerUUID) {
    if (!playerUUID) return [];
    const all = await this.getPlayerStore(STORES.eventBuff, playerUUID);
    const now = Date.now();
    return all.filter((buff) => {
      if (!buff.expiresAt) return true;
      const expires = new Date(buff.expiresAt).getTime();
      return Number.isFinite(expires) ? expires > now : true;
    });
  }

  async clearEventBuffsForPlayer(playerUUID) {
    if (!playerUUID) return;
    const all = await this.getPlayerStore(STORES.eventBuff, playerUUID);
    for (const buff of all) {
      // eslint-disable-next-line no-await-in-loop
      await this.remove(STORES.eventBuff, buff.UUID);
    }
  }

  /**
   * Idempotent. Inserts the three system events if they aren't present.
   * Uses deterministic UUIDs so re-running this is a no-op.
   */
  async seedSpecialEvents() {
    await this.ready;
    const existing = await this.getAll(STORES.customEvent);
    const byUUID = Object.fromEntries(existing.map((e) => [e.UUID, e]));
    const now = new Date().toISOString();

    const seeds = [
      {
        UUID:         'special-wake-time',
        ownerUUID:    null,
        name:         'Wake Up Time',
        description:  'Tracks how close you open the app to your set wake-up time each IGT day.',
        type:         'special',
        specialKind:  'wake_time',
        maxBonusPct:  15,
        bannerColor:  null,
        bannerImageUrl: null,
        accentColor:  null,
        createdAt:    now,
        updatedAt:    now,
      },
      {
        UUID:         'special-first-match',
        ownerUUID:    null,
        name:         'First Match of the Day',
        description:  'Tracks how quickly you start your first match after waking up each day.',
        type:         'special',
        specialKind:  'first_match',
        maxBonusPct:  12,
        bannerColor:  null,
        bannerImageUrl: null,
        accentColor:  null,
        createdAt:    now,
        updatedAt:    now,
      },
      {
        UUID:         'special-entertainment',
        ownerUUID:    null,
        name:         'Work Day Discipline',
        description:  'Fires when you make it through your work day without consuming entertainment items.',
        type:         'special',
        specialKind:  'entertainment',
        maxBonusPct:  5,
        bannerColor:  null,
        bannerImageUrl: null,
        accentColor:  null,
        createdAt:    now,
        updatedAt:    now,
      },
    ];

    for (const seed of seeds) {
      if (!byUUID[seed.UUID]) {
        // eslint-disable-next-line no-await-in-loop
        await this.add(STORES.customEvent, seed);
      }
    }
  }

  async getLastEventType(types, playerUUID = null) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.event, 'readonly');
      const objectStore = transaction.objectStore(STORES.event);
      const request = objectStore.index('createdAt').openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const entry = cursor.value;
        const typeMatches = Array.isArray(types) ? types.includes(entry.type) : types === entry.type;
        const playerMatches = !playerUUID || entry.parent === playerUUID;
        if (typeMatches && playerMatches) resolve(entry);
        else cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export default DatabaseConnection;