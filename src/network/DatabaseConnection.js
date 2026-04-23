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
        resolve();
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
    };
  }

  async getDataPayload() {
    await this.ready;
    const [tasks, journals, events, shop, todos, transactions, inventory, matches, friendships, notifications, chatMessages, journalComments, projects] = await Promise.all([
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
      STORES.journalComment, STORES.project,
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