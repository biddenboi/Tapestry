
const DB_NAME = 'canopy-local-cache';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const QUEUE_STORE = 'queue';

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'userId' });
      }

      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function emptySnapshot(userId) {
  return {
    userId,
    todos: [],
    tasks: [],
    journals: [],
    profile: null,
    lastSyncedAt: null,
    lastSyncError: null,
    updatedAt: new Date().toISOString(),
  };
}

async function withStore(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;

    Promise.resolve()
      .then(() => callback(store))
      .then(value => { result = value; })
      .catch(reject);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function getSnapshot(userId) {
  if (!userId) return emptySnapshot('anonymous');
  return withStore(SNAPSHOT_STORE, 'readonly', async store => {
    const snapshot = await promisifyRequest(store.get(userId));
    return snapshot || emptySnapshot(userId);
  });
}

export async function setSnapshot(userId, snapshot) {
  return withStore(SNAPSHOT_STORE, 'readwrite', async store => {
    const record = {
      ...emptySnapshot(userId),
      ...snapshot,
      userId,
      updatedAt: new Date().toISOString(),
    };
    await promisifyRequest(store.put(record));
    return record;
  });
}

export async function updateSnapshot(userId, updater) {
  const current = await getSnapshot(userId);
  const next = await updater({ ...current });
  return setSnapshot(userId, { ...current, ...next });
}

export async function enqueueOperation(userId, operation) {
  if (!userId) return null;
  return withStore(QUEUE_STORE, 'readwrite', async store => {
    const item = {
      id: operation.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      userId,
      createdAt: operation.createdAt || new Date().toISOString(),
      ...operation,
    };
    await promisifyRequest(store.put(item));
    return item;
  });
}

export async function getQueuedOperations(userId) {
  if (!userId) return [];
  return withStore(QUEUE_STORE, 'readonly', async store => {
    const index = store.index('userId');
    const items = await promisifyRequest(index.getAll(userId));
    return (items || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  });
}

export async function removeQueuedOperation(id) {
  return withStore(QUEUE_STORE, 'readwrite', async store => {
    await promisifyRequest(store.delete(id));
  });
}

export async function getPendingCount(userId) {
  const items = await getQueuedOperations(userId);
  return items.length;
}