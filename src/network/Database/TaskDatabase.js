class TaskDatabase {
    databaseConnection = null;

    constructor(databaseConnection) {
        this.databaseConnection = databaseConnection;  
    }
    
    async clearTaskData() {
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction(["taskObjectStore"], "readwrite");
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
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction(["taskObjectStore"], "readwrite");
        
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
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction(["taskObjectStore"], "readwrite");
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
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction("taskObjectStore", "readonly");
            const tasks = transaction.objectStore("taskObjectStore");

            const request = tasks.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        })
    }


    async getTasksFromRange(startDate, endDate) {
        await this.databaseConnection.ready;
     
         return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction("taskObjectStore", "readonly");
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
        await this.databaseConnection.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.databaseConnection.database.transaction("taskObjectStore", "readonly");
           const store = transaction.objectStore("taskObjectStore");
       
           const request = store.get(localCreatedAt);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }
}

export default TaskDatabase;