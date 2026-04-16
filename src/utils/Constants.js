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
  cosmetic_theme: 'cosmetic_theme',
  cosmetic_font: 'cosmetic_font',
  cosmetic_banner: 'cosmetic_banner',
};

export const ITEM_CLASS = {
  consumable: 'consumable',
  toggle: 'toggle',
  unlock: 'unlock',
};

export const COSMETIC_THEMES = [
  { id: 'default', label: 'Steel Blue',   cost: 0,    free: true  },
  { id: 'crimson', label: 'Crimson',      cost: 500,  free: false },
  { id: 'emerald', label: 'Emerald',      cost: 500,  free: false },
  { id: 'violet',  label: 'Violet',       cost: 500,  free: false },
  { id: 'gold',    label: 'Gold Emperor', cost: 1000, free: false },
  { id: 'shadow',  label: 'Shadow Black', cost: 750,  free: false },
];

export const COSMETIC_FONTS = [
  { id: 'default',  label: 'Rajdhani',  cost: 0,   free: true  },
  { id: 'mono',     label: 'Mono',      cost: 200, free: false },
  { id: 'orbitron', label: 'Orbitron',  cost: 350, free: false },
  { id: 'exo',      label: 'Exo 2',     cost: 200, free: false },
];
