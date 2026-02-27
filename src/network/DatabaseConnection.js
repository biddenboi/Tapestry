class DatabaseConnection {
    database = null;

    isCompatable() {
        return window.indexedDB;
    }

    async handleVersionUpgrades(event) {
    this.database = event.target.result;
    const oldVersion = event.oldVersion;
    const transaction = event.target.transaction;

    if (oldVersion > 0 && oldVersion < 8) {
        console.warn("Database version too old. Please clear your data and refresh.");
    }

    if (oldVersion < 8) {
        const newPlayerStore = this.database.createObjectStore("playerObjectStore", { keyPath: "localCreatedAt" });
        newPlayerStore.createIndex("username", "username", { unique: false });
        newPlayerStore.createIndex("createdAt", "createdAt", { unique: false });

        const newTaskStore = this.database.createObjectStore("taskObjectStore", { keyPath: "localCreatedAt" });
        newTaskStore.createIndex("createdAt", "createdAt", { unique: false });
        newTaskStore.createIndex("distractions", "distractions", { unique: false });
        newTaskStore.createIndex("duration", "duration", { unique: false });
        newTaskStore.createIndex("efficiency", "efficiency", { unique: false });
        newTaskStore.createIndex("estimatedBuffer", "estimatedBuffer", { unique: false });
        newTaskStore.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
        newTaskStore.createIndex("location", "location", { unique: false });
        newTaskStore.createIndex("points", "points", { unique: false });
        newTaskStore.createIndex("reasonToSelect", "reasonToSelect", { unique: false });
        newTaskStore.createIndex("similarity", "similarity", { unique: false });
        newTaskStore.createIndex("taskName", "taskName", { unique: false });
        newTaskStore.createIndex("timeOfStart", "timeOfStart", { unique: false });
    }

    if (oldVersion < 9) {
        const playerStore = transaction.objectStore("playerObjectStore");
        playerStore.createIndex("description", "description", { unique: false });
    }
}
    constructor() {
        if (!this.isCompatable()) {
            alert("Browser incompatability with IndexDB.");
        } 

        this.ready = new Promise((resolve, reject) => {

            //Reminder: when testing version updates change db version and version update if functions at same time
            const request = window.indexedDB.open("CheckpointDatabase", 9);

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

    async getDataAsJSON() {
        await this.ready;

        return new Promise(async (resolve, reject) => {
            //so what this does is basically convert the data into a string, blob gives the data a location which is in url, and then we create an attribute with download using HTML 5 download method
            const tasks = await this.getTasks();
            const players = await this.getPlayers();

            const data = {
                tasks: tasks,
                players: players
            }

            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = 'data.json';
            link.click();

            URL.revokeObjectURL(url); //revoke since blob urls don't get collected by garbage collector
        })
    }

    /** player methods */

    async putPlayer(player) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["playerObjectStore"], "readwrite");

            const players = transaction.objectStore("playerObjectStore");
            const request = players.put(player);

            transaction.oncomplete = () => {
                resolve();
            }

            transaction.onerror = () => {
                reject(transaction.error);
            }

            return request;
        })
    }

    async getPlayer(localCreatedAt) {
        await this.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.database.transaction("playerObjectStore", "readonly");
           const store = transaction.objectStore("playerObjectStore");
       
           const request = store.get(localCreatedAt);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }

    async createPlayer(player) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["playerObjectStore"], "readwrite");
            const players = transaction.objectStore("playerObjectStore");

            const request = players.get(player.localCreatedAt);

            request.onsuccess = (event) => {
                const result = request.result;

                if (result === undefined) {
                    players.add(player)
                }else {
                    //player already exists
                }
            }

            request.onerror = (event) => {
                reject(request.error);
            }

            transaction.oncomplete = (event) => {
                resolve();
            }

            transaction.onerror = (event) => {
                reject(transaction.error);
            }
        })
    }

    async clearPlayerData() {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["playerObjectStore"], "readwrite");
            const players = transaction.objectStore("playerObjectStore");

            const objectStoreRequest = players.clear();

            objectStoreRequest.onsuccess = (e) => {
                resolve();
            }

            objectStoreRequest.onerror = (e) => {
                reject(objectStoreRequest.error);
            }
        })
    }

    async getPlayers() {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("playerObjectStore", "readonly");
            const players = transaction.objectStore("playerObjectStore");

            const request = players.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        })
    }

    /* Task methods */ 

        async clearTaskData() {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["taskObjectStore"], "readwrite");
            const tasks = transaction.objectStore("taskObjectStore");

            const objectStoreRequest = tasks.clear();

            objectStoreRequest.onsuccess = (e) => {
                resolve();
            }

            objectStoreRequest.onerror = (e) => {
                reject(objectStoreRequest.error);
            }
        })
    }

    //localCreatedAt, username, taskName, taskDescription, taskDifficulty
    async addTaskLog(task) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["taskObjectStore"], "readwrite");
        
            const tasks = transaction.objectStore("taskObjectStore");
            const request = tasks.put(task);  
            
            transaction.oncomplete = () => {
                resolve();
            }

            transaction.onerror = () => {
                reject(transaction.error);
            }

            return request;
        })
    }

    async removeTaskLog(localCreatedAt) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["taskObjectStore"], "readwrite");
            const tasksObjectStore = transaction.objectStore("taskObjectStore");
            const request = tasksObjectStore.delete(localCreatedAt);

            transaction.oncomplete = () => {
                resolve();
            }

            transaction.onerror = () => {
                reject(transaction.error);
            }
        })
    }

    async getTasks() {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("taskObjectStore", "readonly");
            const tasks = transaction.objectStore("taskObjectStore");

            const request = tasks.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        })
    }

    async getTasksFromRange(startDate, endDate) {
        await this.ready;
     
         return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("taskObjectStore", "readonly");
            const tasks = transaction.objectStore("taskObjectStore");
            const dateRange = IDBKeyRange.bound(startDate, endDate, false, false);
            const results = [];
     
            tasks.openCursor(dateRange).onsuccess = (event) => {
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
    async getTask(localCreatedAt) {
        await this.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.database.transaction("taskObjectStore", "readonly");
           const store = transaction.objectStore("taskObjectStore");
       
           const request = store.get(localCreatedAt);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }
}

export default DatabaseConnection;