export const DATABASE_VERSION = 1;

export const SECOND = 1000;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;

export const STORES = {
    task: "taskObjectStore",
    player: "playerObjectStore",
    journal: "journalObjectStore",
    event: "eventObjectStore",
    shop: "shopObjectStore",
    todo: "todoObjectStore",
    transaction: "transactionObjectStore",
}

export const EVENT = {
    wake: "ENTER",
    sleep: "EXIT",
    end_work: "END"
}