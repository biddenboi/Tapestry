export const DATABASE_VERSION = 3;

export const SECOND = 1000;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;
export const WEEK = DAY * 7;

export const STRING_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const STORES = {
    task:        "taskObjectStore",
    player:      "playerObjectStore",
    journal:     "journalObjectStore",
    event:       "eventObjectStore",
    shop:        "shopObjectStore",
    todo:        "todoObjectStore",
    transaction: "transactionObjectStore",
    inventory:   "inventoryObjectStore",
    avatar:      "profileAvatarObjectStore",
}

export const EVENT = {
    wake:     "enter",
    sleep:    "exit",
    end_work: "end-work",
}

export const ITEM_TYPE = {
    duration: "duration",
    quantity: "quantity",
}