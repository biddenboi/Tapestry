import { DATABASE_VERSION, STORES } from '../utils/Constants.js'
import { addDurationToDate } from '../utils/Helpers/Time.js';


class DatabaseConnection {
    database = null;

    isCompatable() {
        return window.indexedDB;
    }

    async handleVersionUpgrades(event) {
    this.database = event.target.result;
    const oldVersion = event.oldVersion;

    if (oldVersion > 0 && oldVersion < 1) {
        console.warn("Database version too old. Please clear your data and refresh.");
    }

    if (DATABASE_VERSION >= 1 && oldVersion < 1) {
        const tasks = this.database.createObjectStore(STORES.task, { keyPath: "UUID" });
        tasks.createIndex("createdAt", "createdAt", { unique: false });
        tasks.createIndex("duration", "duration", { unique: false });
        tasks.createIndex("parent", "parent", { unique: false });
        tasks.createIndex("efficiency", "efficiency", { unique: false });
        tasks.createIndex("estimatedBuffer", "estimatedBuffer", { unique: false });
        tasks.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
        tasks.createIndex("location", "location", { unique: false });
        tasks.createIndex("points", "points", { unique: false });
        tasks.createIndex("taskName", "taskName", { unique: false });
        tasks.createIndex("completedAt", "completedAt", { unique: false });

        const journals = this.database.createObjectStore(STORES.journal, { keyPath: "UUID"});
        journals.createIndex("createdAt", "createdAt", { unique: false });
        journals.createIndex("title", "title", { unique: false });
        journals.createIndex("entry", "entry", { unique: false });
        journals.createIndex("parent", "parent", { unique: false });

        const players = this.database.createObjectStore(STORES.player, { keyPath: "UUID" });
        players.createIndex("username", "username", { unique: false });
        players.createIndex("createdAt", "createdAt", { unique: false });
        players.createIndex("description", "description", { unique: false });
        players.createIndex("tokens", "tokens", { unique:false })
        players.createIndex("wakeTime", "wakeTime", { unique:false })
        players.createIndex("sleepTime", "sleepTime", { unique:false })

        const events = this.database.createObjectStore(STORES.event, { keyPath: "UUID" });
        events.createIndex("type", "type", { unique:false })
        events.createIndex("description", "description", { unique:false })
        events.createIndex("createdAt", "createdAt", { unique:false })
        events.createIndex("UUID", "UUID", { unique:false })
        events.createIndex("parent", "parent", { unique:false })

        const shops = this.database.createObjectStore(STORES.shop, { keyPath: "UUID" });
        shops.createIndex("name", "name", { unique:false })
        shops.createIndex("description", "description", { unique:false })
        shops.createIndex("type", "type", { unique:false })
       
        const todos = this.database.createObjectStore(STORES.todo, { keyPath: "UUID" });
        todos.createIndex("difficulty", "difficulty", { unique: false });
        todos.createIndex("dueDate", "dueDate", { unique: false });
        todos.createIndex("createdAt", "createdAt", { unique: false });
        todos.createIndex("distractions", "distractions", { unique: false });
        todos.createIndex("parent", "parent", { unique: false });
        todos.createIndex("efficiency", "efficiency", { unique: false });
        todos.createIndex("estimatedBuffer", "estimatedBuffer", { unique: false });
        todos.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
        todos.createIndex("location", "location", { unique: false });
        todos.createIndex("reasonToSelect", "reasonToSelect", { unique: false });
        todos.createIndex("similarity", "similarity", { unique: false });
        todos.createIndex("taskName", "taskName", { unique: false });

        const transactions = this.database.createObjectStore(STORES.transaction, { keyPath: "UUID" });
        transactions.createIndex("name", "name", { unique: false });
        transactions.createIndex("createdAt", "createdAt", { unique: false });
        transactions.createIndex("completedAt", "completedAt", { unique: false });
        transactions.createIndex("cost", "cost", { unique: false });
        transactions.createIndex("duration", "duration", { unique: false });
        transactions.createIndex("location", "location", { unique: false });
    }

    if (DATABASE_VERSION >= 2 && oldVersion < 2) {
        const transaction = event.target.transaction;
        const players = transaction.objectStore(STORES.player);
        
        //replacement for draftTask to allow component seperation between session, creation, and todos.
        players.createIndex("activeTask", "activeTask", { unique: false });
    }
}
    constructor() {
        if (!this.isCompatable()) {
            alert("Browser incompatability with IndexDB.");
        } 

        this.ready = new Promise((resolve, reject) => {

            //Reminder: when testing version updates change db version and version update if functions at same time
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
            //Possibly compress into for loop
            const tasks = await this.getAll(STORES.task);
            const players = await this.getAll(STORES.player);
            const journals = await this.getAll(STORES.journal);
            const events = await this.getAll(STORES.event);
            const shop = await this.getAll(STORES.shop);
            const todos = await this.getAll(STORES.todo);
            const transactions = await this.getAll(STORES.transaction);

            const data = {
                tasks: tasks,
                players: players,
                journals: journals,
                events: events,
                todos: todos,
                shop, shop,
                transactions: transactions,
            }

            const replacer = (key, value) => (value === null || value === '') ? undefined : value;
            const json = JSON.stringify(data, replacer);

            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = 'tapestry-dataset.json';
            link.click();

            URL.revokeObjectURL(url); //revoke since blob urls don't get collected by garbage collector

            resolve();
        })
    }

    /**
     * 
     * @param {string} file - a JSON string representation of all the data
     */
    async dataUpload(file) {
        //data can be deleted before upload since on fail the user still has original file

        const dataArray = Object.values(JSON.parse(file));

        // remove i?
        let i = 0;
        for (const [key, value] of Object.entries(STORES)) {
            this.clear(value);

            dataArray[i].forEach((data) => {
                this.add(value, data);
            })
            i++;
        }
    } 

    /**
     * retrieves all of a store for a player in the range of localTime + the elapsed time since midnight for the current day.
     * @param {*} player - player to retrieve the tasks of.
     */
    async getRelativePlayerStore(store, player) {
        const dateMS = (new Date()).getTime();
       
        const current = await this.getCurrentPlayer();
        const dateMidnightMS = new Date(current.createdAt).getTime()

        const msElapsed = dateMS - dateMidnightMS;

        const startDate = player.createdAt;
        const endDate = addDurationToDate(new Date(startDate), msElapsed).toISOString();

        const data = await this.getStoreFromRange(store, startDate, endDate);
        
        return data;
    }

    async getStoreFromRange(store, startDate, endDate) {
        await this.ready;
     
         return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readonly");
            const objectStore = transaction.objectStore(store);
            const index = objectStore.index("createdAt")
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
            }
             
            transaction.onerror = () => reject(transaction.error);
         })
    }

    /**
     * retrieves all the objectStore data for a player over its entire span.
     * @param {*} player - player to retrieve the tasks of.
     */
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
                resolve(cursor.value);
            }

            request.onerror = (e) => {
                reject(request.error);
            }
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

            request.onsuccess = (event) => {
                resolve(request.result);
            }

            request.onerror = (event) => {
                reject(request.error);
            }
        })
    }

    async remove(store, UUID) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readwrite");
            const objectStore = transaction.objectStore(store);
            const request = objectStore.delete(UUID);

            request.onsuccess = () => {
                resolve();
            }

            request.onerror = () => {
                reject(transaction.error);
            }
        })
    }

    async clear(store) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(store, "readwrite");
            const objectStore = transaction.objectStore(store);

            const objectStoreRequest = objectStore.clear();

            objectStoreRequest.onsuccess = (e) => {
                resolve();
            }

            objectStoreRequest.onerror = (e) => {
                reject(objectStoreRequest.error);
            }
        })
    }

    //use sparingly
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

    async getLastEventType(type) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("eventObjectStore", "readonly");
            const objectStore = transaction.objectStore("eventObjectStore");
            
            const index = objectStore.index("createdAt"); 

            const request = index.openCursor(null, "prev"); 

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor) {
                    if (cursor.value.type === type) {
                        resolve(cursor.value); 
                    } else {
                        cursor.continue(); 
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = (err) => reject(err);
        });
    }
}

export default DatabaseConnection;