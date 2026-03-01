import { getLocalDateAtMidnight, getLocalDate, addDurationToString, formatDateAsLocalString } from '../Helpers.js';
import { DATABASE_VERISON } from '../Constants.js'

class DatabaseConnection {
    database = null;

    isCompatable() {
        return window.indexedDB;
    }

    async handleVersionUpgrades(event) {
    this.database = event.target.result;
    const oldVersion = event.oldVersion;

    if (oldVersion > 0 && oldVersion < 8) {
        console.warn("Database version too old. Please clear your data and refresh.");
    }


    if (DATABASE_VERISON >= 10 && oldVersion < 10) {
        const playerStore = this.database.createObjectStore("playerObjectStore", { keyPath: "localCreatedAt" });
        playerStore.createIndex("username", "username", { unique: false });
        playerStore.createIndex("createdAt", "createdAt", { unique: false });
        playerStore.createIndex("description", "description", { unique: false });

        const taskStore = this.database.createObjectStore("taskObjectStore", { keyPath: "localCreatedAt" });
        taskStore.createIndex("createdAt", "createdAt", { unique: false });
        taskStore.createIndex("distractions", "distractions", { unique: false });
        taskStore.createIndex("duration", "duration", { unique: false });
        taskStore.createIndex("efficiency", "efficiency", { unique: false });
        taskStore.createIndex("estimatedBuffer", "estimatedBuffer", { unique: false });
        taskStore.createIndex("estimatedDuration", "estimatedDuration", { unique: false });
        taskStore.createIndex("location", "location", { unique: false });
        taskStore.createIndex("points", "points", { unique: false });
        taskStore.createIndex("reasonToSelect", "reasonToSelect", { unique: false });
        taskStore.createIndex("similarity", "similarity", { unique: false });
        taskStore.createIndex("taskName", "taskName", { unique: false });
        taskStore.createIndex("timeOfStart", "timeOfStart", { unique: false });
        
        const journal = this.database.createObjectStore("journalObjectStore", { keyPath: "localCreatedAt"});
        journal.createIndex("createdAt", "createdAt", { unique: false });
        journal.createIndex("title", "title", { unique: false });
        journal.createIndex("entry", "entry", { unique: false });
    }

    if (DATABASE_VERISON >= 11 && oldVersion < 11) {
        const transaction = event.target.transaction;
        const taskStore = transaction.objectStore("taskObjectStore");

        taskStore.createIndex("localCompletedAt", "localCompletedAt", { unique: false });

        const cursorRequest = taskStore.openCursor();

        cursorRequest.onsuccess = (e) => {
            const cursor = e.target.result;

            if (cursor) {
                const value = cursor.value;

                const completedAtDate = addDurationToString(value.localCreatedAt, value.duration);
                if (!value.localCompletedAt) {
                    value.localCompletedAt = formatDateAsLocalString(completedAtDate);

                    cursor.update(value);
                }

                cursor.continue();
            }
        }
    }
}
    constructor() {
        if (!this.isCompatable()) {
            alert("Browser incompatability with IndexDB.");
        } 

        this.ready = new Promise((resolve, reject) => {

            //Reminder: when testing version updates change db version and version update if functions at same time
            const request = window.indexedDB.open("CheckpointDatabase", DATABASE_VERISON);

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
            //so what this does is basically convert the data into a string, blob gives the data a location which is in url, and then we create an attribute with download using HTML 5 download method
            const tasks = await this.getTasks();
            const players = await this.getPlayers();
            const journals = await this.getJournals();

            const data = {
                tasks: tasks,
                players: players,
                journals:journals
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

    /**
     * 
     * @param {string} file - a JSON string representation of all the data
     */
    async dataUpload(file) {
        //data can be deleted before upload since on fail the user still has original file

        const dataArray = Object.values(JSON.parse(file));
        const taskData = dataArray[0];
        const playerData = dataArray[1];
        const journalData = dataArray[2];

        //remove all task data and add from new file.
        this.clearTaskData();
    
        taskData.forEach((task) => {
          this.addTaskLog(task);
        })

        //remove all player data and add from new file.
        this.clearPlayerData();

        playerData.forEach(async (player) => {
            const playerTasks = await this.getPlayerTasks(player);

            if (playerTasks.length != 0) {
                this.createPlayer(player);
            }
        })

        //remove all player data and add from new file.
        this.clearJournalData();
    
        journalData.forEach((journal) => {
          this.addJournalLog(journal);
        })
    } 

    /** player methods */

    //each player has a defined date (localTime) in which it was created.
    //Tasks are the same with the local time, regardless of timezone the tasks will match to the player.

    /**
     * @param {*} player - player to add
     */
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

    /**
     * retrieves all the tasks for a player in the range of localTime + the elapsed time since midnight for the current day.
     * @param {*} player - player to retrieve the tasks of.
     */
    async getRelativePlayerTasks(player) {
        const lastMidnight = getLocalDateAtMidnight();
        const currentTime = getLocalDate();
        const msElapsed = currentTime - lastMidnight;

        //grabs the tasks for each player between their respect ive midnight + duration since current days midnight
        //allows syncronous gameplay
        const startDate = player.localCreatedAt;
        const endDate = (addDurationToString(startDate, msElapsed)).toISOString();

        const tasks = await this.getTasksFromRange(startDate, endDate);
        
        return tasks;
    }

    /**
     * retrieves all the tasks for a player over its entire span.
     * @param {*} player - player to retrieve the tasks of.
     */
    async getPlayerTasks(player) {
        const startDate = player.localCreatedAt;
        const endDate = (addDurationToString(player.localCreatedAt, 86400000)).toISOString();

        const tasks = await this.getTasksFromRange(startDate, endDate);
        
        return tasks;
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

    async getIncompleteTasks() {
        //REVIEW
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(['taskObjectStore'], 'readonly');
            const store = transaction.objectStore('taskObjectStore');

            const todos = [];
            const request = store.openCursor();

            request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const task = cursor.value;

                if (task.localCompletedAt == null) {
                todos.push(task);
                }

                cursor.continue();
            } else {
                resolve(todos);
            }
            };

            request.onerror = () => {
            reject(request.error);
            };
        });
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

    /** journal methods */

    async getJournal(localCreatedAt) {
        await this.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.database.transaction("journalObjectStore", "readonly");
           const store = transaction.objectStore("journalObjectStore");
       
           const request = store.get(localCreatedAt);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }

    async clearJournalData() {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["journalObjectStore"], "readwrite");
            const journals = transaction.objectStore("journalObjectStore");

            const objectStoreRequest = journals.clear();

            objectStoreRequest.onsuccess = (e) => {
                resolve();
            }

            objectStoreRequest.onerror = (e) => {
                reject(objectStoreRequest.error);
            }
        })
    }

    async addJournalLog(entry) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["journalObjectStore"], "readwrite");
        
            const journals = transaction.objectStore("journalObjectStore");
            const request = journals.put(entry);  
            
            transaction.oncomplete = () => {
                resolve();
            }

            transaction.onerror = () => {
                reject(transaction.error);
            }

            return request;
        })
    }

    async getJournalsFromRange(startDate, endDate) {
        await this.ready;
     
         return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("journalObjectStore", "readonly");
            const entries = transaction.objectStore("journalObjectStore");
            const dateRange = IDBKeyRange.bound(startDate, endDate, false, false);
            const results = [];
     
            entries.openCursor(dateRange).onsuccess = (event) => {
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

    async getRelativePlayerJournals(player) {
        const lastMidnight = getLocalDateAtMidnight();
        const currentTime = getLocalDate();
        const msElapsed = currentTime - lastMidnight;

        //grabs the tasks for each player between their respect ive midnight + duration since current days midnight
        //allows syncronous gameplay
        const startDate = player.localCreatedAt;
        const endDate = (addDurationToString(startDate, msElapsed)).toISOString();

        const tasks = await this.getJournalsFromRange(startDate, endDate);
        
        return tasks;
    }

    async getJournals() {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("journalObjectStore", "readonly");
            const journals = transaction.objectStore("journalObjectStore");

            const request = journals.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        })
    }
}

export default DatabaseConnection;