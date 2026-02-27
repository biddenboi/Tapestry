class PlayerDatabase {
    databaseConnection = null;

    constructor(databaseConnection) {
        this.databaseConnection = databaseConnection;
    }

    async putPlayer(player) {
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction(["playerObjectStore"], "readwrite");

            const players = transaction.objectStore("playerObjectStore");
            const request = players.put(player);

            transaction.oncomplete = (event) => {
                resolve();
            }

            transaction.onerror = (event) => {
                reject(transaction.error);
            }

            return request;
        })
    }

    async getPlayer(localCreatedAt) {
        await this.databaseConnection.ready;
       
        return new Promise((resolve, reject) => {
           const transaction = this.databaseConnection.database.transaction("playerObjectStore", "readonly");
           const store = transaction.objectStore("playerObjectStore");
       
           const request = store.get(localCreatedAt);
       
           request.onsuccess = () => resolve(request.result);
           request.onerror = () => reject(request.error);
           transaction.onerror = () => reject(transaction.error);
         });
    }

    async createPlayer(player) {
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction(["playerObjectStore"], "readwrite");
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
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction(["playerObjectStore"], "readwrite");
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
        await this.databaseConnection.ready;

        return new Promise((resolve, reject) => {
            const transaction = this.databaseConnection.database.transaction("playerObjectStore", "readonly");
            const players = transaction.objectStore("playerObjectStore");

            const request = players.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onerror = () => reject(transaction.error);
        })
    }
}

export default PlayerDatabase;