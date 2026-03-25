import { DATABASE_VERSION, STORES } from '../utils/Constants.js'
import { getMidnightOfDate, formatDateAsLocalString, addDurationToDate, getMidnightInUTC } from '../utils/Helpers/Time.js';


class DatabaseConnection {
    database = null;

    isCompatable() {
        return window.indexedDB;
    }

    async handleVersionUpgrades(event) {
    this.database = event.target.result;
    const oldVersion = event.oldVersion;

    if (oldVersion > 0 && oldVersion < 9) {
        console.warn("Database version too old. Please clear your data and refresh.");
    }


    if (oldVersion < 10) {
        const playerStore = this.database.createObjectStore("playerObjectStore", { keyPath: "UUID" });
        playerStore.createIndex("username", "username", { unique: false });
        playerStore.createIndex("createdAt", "createdAt", { unique: false });
        playerStore.createIndex("description", "description", { unique: false });

        const taskStore = this.database.createObjectStore("taskObjectStore", { keyPath: "UUID" });
        //clean up and delete some keys
        taskStore.createIndex("createdAt", "createdAt", { unique: false });
        taskStore.createIndex("distractions", "distractions", { unique: false });
        taskStore.createIndex("duration", "duration", { unique: false });
        taskStore.createIndex("parent", "parent", { unique: false });
        taskStore.createIndex("efficiency", "efficiency", { unique: false });
        taskStore.createIndex("estimatedBuffer", "estimatedBuffer", { unique: false });
        taskStore.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
        taskStore.createIndex("location", "location", { unique: false });
        taskStore.createIndex("points", "points", { unique: false });
        taskStore.createIndex("reasonToSelect", "reasonToSelect", { unique: false });
        taskStore.createIndex("similarity", "similarity", { unique: false });
        taskStore.createIndex("taskName", "taskName", { unique: false });
        taskStore.createIndex("timeOfStart", "timeOfStart", { unique: false });
        taskStore.createIndex("completedAt", "completedAt", { unique: false });
        
        const journal = this.database.createObjectStore("journalObjectStore", { keyPath: "UUID"});
        journal.createIndex("createdAt", "createdAt", { unique: false });
        journal.createIndex("title", "title", { unique: false });
        journal.createIndex("entry", "entry", { unique: false });
        journal.createIndex("parent", "parent", { unique: false });
    }

    if (DATABASE_VERSION >= 11 && oldVersion < 11) {
        const transaction = event.target.transaction
        const playerStore = transaction.objectStore("playerObjectStore")
        playerStore.createIndex("tokens", "tokens", { unique:false })
        playerStore.createIndex("wakeTime", "wakeTime", { unique:false })
        playerStore.createIndex("sleepTime", "sleepTime", { unique:false })
    }

    if (DATABASE_VERSION >= 12 && oldVersion < 12) {
        const eventObjectStore = this.database.createObjectStore("eventObjectStore", { keyPath: "UUID" });
        eventObjectStore.createIndex("type", "type", { unique:false })
        eventObjectStore.createIndex("description", "description", { unique:false })
        eventObjectStore.createIndex("createdAt", "createdAt", { unique:false })
        eventObjectStore.createIndex("UUID", "UUID", { unique:false })
        eventObjectStore.createIndex("parent", "parent", { unique:false })
    }

    if (DATABASE_VERSION >= 13 && oldVersion < 13) {
        const shopObjectStore = this.database.createObjectStore("shopObjectStore", { keyPath: "UUID" });
        shopObjectStore.createIndex("name", "name", { unique:false })
        shopObjectStore.createIndex("description", "description", { unique:false })

        //of quantity or time
        shopObjectStore.createIndex("type", "type", { unique:false })
    }

    if (DATABASE_VERSION >= 14 && oldVersion < 14) {
        const todoObjectStore = this.database.createObjectStore("todoObjectStore", { keyPath: "UUID" });
        todoObjectStore.createIndex("createdAt", "createdAt", { unique: false });
        todoObjectStore.createIndex("distractions", "distractions", { unique: false });
        todoObjectStore.createIndex("parent", "parent", { unique: false });
        todoObjectStore.createIndex("efficiency", "efficiency", { unique: false });
        todoObjectStore.createIndex("estimatedBuffer", "estimatedBuffer", { unique: false });
        todoObjectStore.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
        todoObjectStore.createIndex("location", "location", { unique: false });
        todoObjectStore.createIndex("reasonToSelect", "reasonToSelect", { unique: false });
        todoObjectStore.createIndex("similarity", "similarity", { unique: false });
        todoObjectStore.createIndex("taskName", "taskName", { unique: false });
    }
    if (DATABASE_VERSION >= 15 && oldVersion < 15) {
        const transaction = event.target.transaction;
        const todoObjectStore = transaction.objectStore("todoObjectStore");

        todoObjectStore.createIndex("difficulty", "difficulty", { unique: false });
        todoObjectStore.createIndex("dueDate", "dueDate", { unique: false });
    }
    if (DATABASE_VERSION >= 16 && oldVersion < 16) {
        const transactionObjectStore = this.database.createObjectStore("transactionObjectStore", { keyPath: "UUID" });
        transactionObjectStore.createIndex("name", "name", { unique: false });
        transactionObjectStore.createIndex("createdAt", "createdAt", { unique: false });
        transactionObjectStore.createIndex("completedAt", "completedAt", { unique: false });
        transactionObjectStore.createIndex("cost", "cost", { unique: false });
        transactionObjectStore.createIndex("duration", "duration", { unique: false });
        transactionObjectStore.createIndex("location", "location", { unique: false });
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
            const todos = await this.getAll(STORES.todo);
            const transactions = await this.getAll(STORES.transaction);

            const data = {
                tasks: tasks,
                players: players,
                journals: journals,
                events: events,
                todos: todos,
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