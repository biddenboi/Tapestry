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

  async getDataAsJSON() {
    await this.ready;
    const [tasks, players, journals, events, shop, todos, transactions, inventory, matches, friendships, notifications] = await Promise.all([
      this.getAll(STORES.task),
      this.getAll(STORES.player),
      this.getAll(STORES.journal),
      this.getAll(STORES.event),
      this.getAll(STORES.shop),
      this.getAll(STORES.todo),
      this.getAll(STORES.transaction),
      this.getAll(STORES.inventory),
      this.getAll(STORES.match),
      this.getAll(STORES.friendship),
      this.getAll(STORES.notification),
    ]);

    const data = { tasks, players, journals, events, shop, todos, transactions, inventory, matches, friendships, notifications };
    const json = JSON.stringify(data, (key, value) => (value == null || value === '' ? undefined : value));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tapestry-dataset.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async dataUpload(fileContents) {
    const data = JSON.parse(fileContents);
    for (const storeName of Object.values(STORES)) {
      await this.clear(storeName).catch(() => undefined);
    }

    const mapping = {
      tasks: STORES.task,
      players: STORES.player,
      journals: STORES.journal,
      events: STORES.event,
      shop: STORES.shop,
      todos: STORES.todo,
      transactions: STORES.transaction,
      inventory: STORES.inventory,
      matches: STORES.match,
      friendships: STORES.friendship,
      notifications: STORES.notification,
    };

    for (const [key, storeName] of Object.entries(mapping)) {
      for (const entry of data[key] || []) {
        // eslint-disable-next-line no-await-in-loop
        await this.add(storeName, entry);
      }
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


  isLegacyBootstrapPlayer(player) {
    if (!player) return false;
    return player.username === 'Agent'
      && player.description === 'A fresh challenger enters the hub.'
      && Number(player.tokens || 0) === 0
      && Number(player.minutesClearedToday || 0) === 0
      && Number(player.elo || 0) === 1000;
  }

  async getCurrentPlayer() {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.player, 'readonly');
      const objectStore = transaction.objectStore(STORES.player);
      const request = objectStore.index('createdAt').openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        if (this.isLegacyBootstrapPlayer(cursor.value)) {
          cursor.continue();
          return;
        }
        resolve(cursor.value);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPlayers() {
    await this.ready;
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORES.player, 'readonly');
      const objectStore = transaction.objectStore(STORES.player);
      const results = [];
      objectStore.index('createdAt').openCursor(null, 'prev').onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (!this.isLegacyBootstrapPlayer(cursor.value)) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      transaction.onerror = () => reject(transaction.error);
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

  async getNotificationsForPlayer(playerUUID) {
    return this.getPlayerStore(STORES.notification, playerUUID);
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

  async getLastEventType(types) {
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
        const type = cursor.value.type;
        const matches = Array.isArray(types) ? types.includes(type) : types === type;
        if (matches) resolve(cursor.value);
        else cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export default DatabaseConnection;
