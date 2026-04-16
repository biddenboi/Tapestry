export const DATABASE_VERSION = 5;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

export const STRING_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STORES = {
  task: 'taskObjectStore',
  journal: 'journalObjectStore',
  player: 'playerObjectStore',
  event: 'eventObjectStore',
  shop: 'shopObjectStore',
  todo: 'todoObjectStore',
  transaction: 'transactionObjectStore',
  inventory: 'inventoryObjectStore',
  match: 'matchObjectStore',
  friendship: 'friendshipObjectStore',
  notification: 'notificationObjectStore',
};

export const GAME_STATE = {
  idle: 'idle',
  practice: 'practice',
  match: 'match',
};

export const MATCH_STATUS = {
  active: 'active',
  complete: 'complete',
  forfeited: 'forfeited',
};

export const EVENT = {
  wake: 'wake',
  end_work: 'end_work',
  sleep: 'sleep',
};

export const ITEM_TYPE = {
  duration: 'duration',
  quantity: 'quantity',
};
