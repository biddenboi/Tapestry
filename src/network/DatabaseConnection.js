import { getLocalDateAtMidnight, getLocalDate, addDurationToString, formatDateAsLocalString } from '../utils/Helpers.js';
import { DATABASE_VERISON } from '../utils/Constants.js'


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


    if (DATABASE_VERISON >= 10 && oldVersion < 10) {
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

    if (DATABASE_VERISON >= 11 && oldVersion < 11) {
        const transaction = event.target.transaction
        const playerStore = transaction.objectStore("playerObjectStore")
        playerStore.createIndex("tokens", "tokens", { unique:false })
        playerStore.createIndex("wakeTime", "wakeTime", { unique:false })
        playerStore.createIndex("sleepTime", "sleepTime", { unique:false })
    }

    if (DATABASE_VERISON >= 12 && oldVersion < 12) {
        const playerStore = this.database.createObjectStore("eventObjectStore", { keyPath: "UUID" });
        playerStore.createIndex("type", "type", { unique:false })
        playerStore.createIndex("description", "description", { unique:false })
        playerStore.createIndex("createdAt", "createdAt", { unique:false })
    }

    /**if (DATABASE_VERISON >= 11 && oldVersion < 11) {
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
    if (DATABASE_VERISON >= 12 && oldVersion < 12) {
        const transaction = event.target.transaction;
        const playerStore = transaction.objectStore("playerObjectStore");
        const taskStore = transaction.objectStore("taskObjectStore");

        playerStore.createIndex("UUID", "UUID", { unique: true });
        
        const playerCursorRequest = playerStore.openCursor();

        playerCursorRequest.onsuccess = (e) => {
            const cursor = e.target.result;
            
            if (cursor) {
                const value = cursor.value;

                if (!value.UUID) {
                    value.UUID = uuid();

                    cursor.update(value);
                }

                cursor.continue();
            }
        }

        taskStore.createIndex("UUID", "UUID", { unique: true });
        
        const taskCursorRequest = taskStore.openCursor();

        taskCursorRequest.onsuccess = async (e) => {
            const cursor = e.target.result;
    
            if (!cursor) return;
            const value = cursor.value;


            if (!value.UUID) {
                value.UUID = uuid();
                
                cursor.update(value);
                    
            } 

            cursor.continue();
        }
    }*/
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
            const playerTasks = await this.getPlayerTasks(player.UUID);

            if (playerTasks.length != 0) {
                this.addPlayer(player);
            }
        })

        //remove all player data and add from new file.
        this.clearJournalData();
    
        journalData.forEach((journal) => {
          this.addJournalLog(journal);
        })
    } 

    /**
     * retrieves all the tasks for a player in the range of localTime + the elapsed time since midnight for the current day.
     * @param {*} player - player to retrieve the tasks of.
     */
    /**async getRelativePlayerTasks(player) {
        const lastMidnight = getLocalDateAtMidnight();
        const currentTime = getLocalDate();
        const msElapsed = currentTime - lastMidnight;

        //grabs the tasks for each player between their respect ive midnight + duration since current days midnight
        //allows syncronous gameplay
        const startDate = player.localCreatedAt;
        const endDate = formatDateAsLocalString(addDurationToString(startDate, msElapsed));

        const tasks = await this.getTasksFromRange(startDate, endDate);
        
        return tasks;
    }*/

    /**
     * retrieves all the tasks for a player over its entire span.
     * @param {*} player - player to retrieve the tasks of.
     */
    async getPlayerTasks(UUID) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("taskObjectStore", "readonly");
            const store = transaction.objectStore("taskObjectStore");
            
            const index = store.index("parent");

            const request = index.getAll(UUID);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        })
    }

    async getCurrentPlayer() {
        await this.ready;
       
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("playerObjectStore", "readonly");
            const store = transaction.objectStore("playerObjectStore");
            const index = store.index("createdAt");

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

    async getPlayer(UUID) {
        await this.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.database.transaction("playerObjectStore", "readonly");
           const store = transaction.objectStore("playerObjectStore");
       
           const request = store.get(UUID);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }

    async addPlayer(player) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["playerObjectStore"], "readwrite");
            const players = transaction.objectStore("playerObjectStore");

            const request = players.put(player);

            request.onsuccess = (event) => {
                resolve(request.result);
            }

            request.onerror = (event) => {
                reject(request.error);
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
            
            request.onsuccess = () => {
                resolve();
            }

            request.onerror = () => {
                reject(request.error);
            }
        })
    }

    async removeTaskLog(UUID) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(["taskObjectStore"], "readwrite");
            const tasksObjectStore = transaction.objectStore("taskObjectStore");
            const request = tasksObjectStore.delete(UUID);

            request.onsuccess = () => {
                resolve();
            }

            request.onerror = () => {
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
        await this.ready;
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

                if (task.completedAt == null) {
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

    /**async getTasksFromRange(startDate, endDate) {
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
    }  */
    
    async getTask(UUID) {
        await this.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.database.transaction("taskObjectStore", "readonly");
           const store = transaction.objectStore("taskObjectStore");
       
           const request = store.get(UUID);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }

    /** journal methods */

    async getJournal(UUID) {
        await this.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.database.transaction("journalObjectStore", "readonly");
           const store = transaction.objectStore("journalObjectStore");
       
           const request = store.get(UUID);
       
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
            
            transaction.onsuccess = () => {
                resolve();
            }

            transaction.onerror = () => {
                reject(transaction.error);
            }

            return request;
        })
    }

    async getPlayerJournals(UUID) {
        await this.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction("journalObjectStore", "readonly");
            const store = transaction.objectStore("journalObjectStore");
            const index = store.index("parent");

            const request = index.getAll(UUID);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        })
    }

    /**async getJournalsFromRange(startDate, endDate) {
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
        const endDate = formatDateAsLocalString(addDurationToString(startDate, msElapsed));

        const tasks = await this.getJournalsFromRange(startDate, endDate);
        
        return tasks;
    }*/

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