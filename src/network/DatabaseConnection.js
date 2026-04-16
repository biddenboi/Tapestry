import { DATABASE_VERSION, STORES } from '../utils/Constants.js'
import { addDurationToDate, getMidnightOfDate } from '../utils/Helpers/Time.js';

class DatabaseConnection {
    database = null;

    isCompatable() {
        return window.indexedDB;
    }

    async handleVersionUpgrades(event) {
        this.database = event.target.result;
        const oldVersion = event.oldVersion;

        if (DATABASE_VERSION >= 1 && oldVersion < 1) {
            const tasks = this.database.createObjectStore(STORES.task, { keyPath: "UUID" });
            tasks.createIndex("createdAt", "createdAt", { unique: false });
            tasks.createIndex("parent", "parent", { unique: false });
            tasks.createIndex("efficiency", "efficiency", { unique: false });
            tasks.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
            tasks.createIndex("location", "location", { unique: false });
            tasks.createIndex("points", "points", { unique: false });
            tasks.createIndex("name", "name", { unique: false });
            tasks.createIndex("completedAt", "completedAt", { unique: false });

            const journals = this.database.createObjectStore(STORES.journal, { keyPath: "UUID" });
            journals.createIndex("createdAt", "createdAt", { unique: false });
            journals.createIndex("title", "title", { unique: false });
            journals.createIndex("entry", "entry", { unique: false });
            journals.createIndex("parent", "parent", { unique: false });

            const players = this.database.createObjectStore(STORES.player, { keyPath: "UUID" });
            players.createIndex("username", "username", { unique: false });
            players.createIndex("createdAt", "createdAt", { unique: false });
            players.createIndex("description", "description", { unique: false });
            players.createIndex("tokens", "tokens", { unique: false });
            players.createIndex("wakeTime", "wakeTime", { unique: false });
            players.createIndex("sleepTime", "sleepTime", { unique: false });
            players.createIndex("minutesClearedToday", "minutesClearedToday", { unique: false });

            const events = this.database.createObjectStore(STORES.event, { keyPath: "UUID" });
            events.createIndex("type", "type", { unique: false });
            events.createIndex("description", "description", { unique: false });
            events.createIndex("createdAt", "createdAt", { unique: false });
            events.createIndex("UUID", "UUID", { unique: false });
            events.createIndex("parent", "parent", { unique: false });

            const shops = this.database.createObjectStore(STORES.shop, { keyPath: "UUID" });
            shops.createIndex("name", "name", { unique: false });
            shops.createIndex("description", "description", { unique: false });
            shops.createIndex("type", "type", { unique: false });
            shops.createIndex("enjoyment", "enjoyment", { unique: false });

            const todos = this.database.createObjectStore(STORES.todo, { keyPath: "UUID" });
            todos.createIndex("dueDate", "dueDate", { unique: false });
            todos.createIndex("efficiency", "efficiency", { unique: false });
            todos.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
            todos.createIndex("name", "name", { unique: false });

            const transactions = this.database.createObjectStore(STORES.transaction, { keyPath: "UUID" });
            transactions.createIndex("name", "name", { unique: false });
            transactions.createIndex("createdAt", "createdAt", { unique: false });
            transactions.createIndex("completedAt", "completedAt", { unique: false });
            transactions.createIndex("cost", "cost", { unique: false });
            transactions.createIndex("duration", "duration", { unique: false });
            transactions.createIndex("location", "location", { unique: false });
        }

        if (DATABASE_VERSION >= 2 && oldVersion < 2) {
            const inventory = this.database.createObjectStore(STORES.inventory, { keyPath: "UUID" });
            inventory.createIndex("parent", "parent", { unique: false });
            inventory.createIndex("itemUUID", "itemUUID", { unique: false });
            inventory.createIndex("name", "name", { unique: false });
            inventory.createIndex("type", "type", { unique: false });
            inventory.createIndex("quantity", "quantity", { unique: false });
        }

        if (DATABASE_VERSION >= 3 && oldVersion < 3) {
            const avatars = this.database.createObjectStore(STORES.avatar, { keyPath: "UUID" });
            avatars.createIndex("parent", "parent", { unique: true });
            avatars.createIndex("updatedAt", "updatedAt", { unique: false });
            avatars.createIndex("byteSize", "byteSize", { unique: false });
        }
    }

    constructor() {
        if (!this.isCompatable()) {
            alert("Browser incompatability with IndexDB.");
        }

        this.ready = new Promise((resolve, reject) => {
            const request = window.indexedDB.open("CheckpointDatabase", DATABASE_VERSION);

            request.onerror = (event) => {
                console.error(`Database error: ${event.target.error?.message}`);
                reject(request.error);
            }

            request.onupgradeneeded = async (event) => {
                await this.handleVersionUpgrades(event);
            }

            request.onsuccess = (event) => {
                this.database = event.target.result;
                resolve();
            }
        })
    }

    /** general methods */

    async getDataAsJSON() {
        await this.ready;

        return new Promise(async (resolve, reject) => {
            try {
                const tasks        = await this.getAll(STORES.task);
                const players      = await this.getAll(STORES.player);
                const journals     = await this.getAll(STORES.journal);
                const events       = await this.getAll(STORES.event);
                const shop         = await this.getAll(STORES.shop);
                const todos        = await this.getAll(STORES.todo);
                const transactions = await this.getAll(STORES.transaction);
                const inventory    = await this.getAll(STORES.inventory);
                const avatars      = await this.getAll(STORES.avatar);

                const data = { tasks, players, journals, events, shop, todos, transactions, inventory, avatars };

                const replacer = (key, value) => (value === null || value === '') ? undefined : value;
                const json = JSON.stringify(data, replacer);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'tapestry-dataset.json';
                link.click();
                URL.revokeObjectURL(url);
                resolve();
            } catch (error) {
                reject(error);
            }
        })
    }

    async dataUpload(file) {
        await this.ready;

        const parsed = JSON.parse(file);
        const dataByStore = {
            [STORES.task]: parsed.tasks ?? [],
            [STORES.player]: parsed.players ?? [],
            [STORES.journal]: parsed.journals ?? [],
            [STORES.event]: parsed.events ?? [],
            [STORES.shop]: parsed.shop ?? [],
            [STORES.todo]: parsed.todos ?? [],
            [STORES.transaction]: parsed.transactions ?? [],
            [STORES.inventory]: parsed.inventory ?? [],
            [STORES.avatar]: parsed.avatars ?? [],
        };

        for (const [store, rows] of Object.entries(dataByStore)) {
            await this.clear(store);
            for (const row of rows) {
                await this.add(store, row);
            }
        }
    }

    async getRelativePlayerStore(store, player) {
        const dateMS = (new Date()).getTime();
        const dateMidnightMS = getMidnightOfDate(new Date()).getTime();
        const msElapsed = dateMS - dateMidnightMS;
        const startDate = 0;
        const endDate = addDurationToDate(new Date(startDate), msElapsed).toISOString();
        return await this.getStoreFromRange(store, startDate, endDate);
    }

    async getStoreFromRange(store, startDate, endDate) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readonly");
            const objectStore = transaction.objectStore(store);
            const index = store == STORES.task
                ? objectStore.index("completedAt")
                : objectStore.index("createdAt");
            const dateRange = IDBKeyRange.bound(startDate, endDate, false, false);
            const results = [];
            index.openCursor(dateRange).onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) { results.push(cursor.value); cursor.continue(); }
                else { resolve(results); }
            }
            transaction.onerror = () => reject(transaction.error);
        })
    }

    async getPlayerStore(store, UUID) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readonly");
            const objectStore = transaction.objectStore(store);
            const index = objectStore.index("parent");
            const request = index.getAll(UUID);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        })
    }

    async getCurrentPlayer() {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("playerObjectStore", "readonly");
            const objectStore = transaction.objectStore("playerObjectStore");
            const index = objectStore.index("createdAt");
            const request = index.openCursor(null, "prev");
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) resolve(null);
                else resolve(cursor.value);
            }
            request.onerror = () => reject(request.error);
        });
    }

    async get(store, UUID) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readonly");
            const objectStore = transaction.objectStore(store);
            const request = objectStore.get(UUID);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async add(store, data) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readwrite");
            const objectStore = transaction.objectStore(store);
            const request = objectStore.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        })
    }

    async remove(store, UUID) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readwrite");
            const objectStore = transaction.objectStore(store);
            const request = objectStore.delete(UUID);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(transaction.error);
        })
    }

    async clear(store) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readwrite");
            const objectStore = transaction.objectStore(store);
            const req = objectStore.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        })
    }

    async getAll(store) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readonly");
            const objectStore = transaction.objectStore(store);
            const request = objectStore.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        })
    }

    async getLastEventType(types) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("eventObjectStore", "readonly");
            const objectStore = transaction.objectStore("eventObjectStore");
            const index = objectStore.index("createdAt");
            const request = index.openCursor(null, "prev");
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const type = cursor.value.type;
                    const matches = Array.isArray(types) ? types.includes(type) : types == type;
                    if (matches) resolve(cursor.value);
                    else cursor.continue();
                } else {
                    resolve(null);
                }
            };
            request.onerror = (err) => reject(err);
        });
    }
}

export default DatabaseConnection;