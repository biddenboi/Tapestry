export const DATABASE_VERSION = 6;

export const ACTIVE_PROFILE_KEY = 'tapestry_active_profile_uuid';

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
  chatMessage: 'chatMessageObjectStore',
};

export const GAME_STATE = {
  idle:  'idle',
  match: 'match',
  dojo:  'dojo',
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
  cosmetic_card_banner: 'cosmetic_card_banner',
  cosmetic_profile_banner: 'cosmetic_profile_banner',
  cosmetic_lobby_banner: 'cosmetic_lobby_banner',
};

export const ITEM_CLASS = {
  consumable: 'consumable',
  toggle: 'toggle',
  unlock: 'unlock',
};

export const COSMETIC_THEMES = [
  // — Dark themes —
  { id: 'default', label: 'Steel Blue',   cost: 0,    free: true,  dark: true  },
  { id: 'crimson', label: 'Crimson',      cost: 500,  free: false, dark: true  },
  { id: 'emerald', label: 'Emerald',      cost: 500,  free: false, dark: true  },
  { id: 'violet',  label: 'Violet',       cost: 500,  free: false, dark: true  },
  { id: 'gold',    label: 'Gold Emperor', cost: 1000, free: false, dark: true  },
  { id: 'shadow',  label: 'Shadow Black', cost: 750,  free: false, dark: true  },
  // — Light themes —
  { id: 'sand',    label: 'Sandy',        cost: 600,  free: false, dark: false },
  { id: 'pure',    label: 'Pure White',   cost: 400,  free: false, dark: false },
  { id: 'paper',   label: 'Paper',        cost: 400,  free: false, dark: false },
  { id: 'rose',    label: 'Rose Quartz',  cost: 600,  free: false, dark: false },
];

export const COSMETIC_FONTS = [
  { id: 'default',   label: 'Rajdhani',     cost: 0,   free: true,  sample: 'Aa Bb' },
  { id: 'orbitron',  label: 'Orbitron',     cost: 350, free: false, sample: 'AA BB' },
  { id: 'exo',       label: 'Exo 2',        cost: 200, free: false, sample: 'Aa Bb' },
  { id: 'mono',      label: 'JetBrains',    cost: 200, free: false, sample: 'Aa Bb' },
  { id: 'syne',      label: 'Syne',         cost: 300, free: false, sample: 'Aa Bb' },
  { id: 'space',     label: 'Space Grotesk',cost: 250, free: false, sample: 'Aa Bb' },
];

export const COSMETIC_PASSES = [
  { id: 'card_banner',    type: 'cosmetic_card_banner',    label: 'Card Banner Pass',    cost: 750,  icon: '◉', desc: 'Customize your player card look in arena matches.' },
  { id: 'profile_banner', type: 'cosmetic_profile_banner', label: 'Profile Banner Pass', cost: 600,  icon: '⬡', desc: 'Set a custom background gradient or image on your profile page.' },
  { id: 'lobby_banner',   type: 'cosmetic_lobby_banner',   label: 'Lobby Banner Pass',   cost: 500,  icon: '◈', desc: 'Set a custom background image on your lobby player card.' },
];

export const BANNER_GRADIENTS = [
  { id: 'deep-ocean',   label: 'Deep Ocean',    value: 'linear-gradient(135deg, #0d1b2a 0%, #1b4965 100%)' },
  { id: 'midnight',     label: 'Midnight',      value: 'linear-gradient(135deg, #09090f 0%, #1a1040 100%)' },
  { id: 'crimson-night',label: 'Crimson Night', value: 'linear-gradient(135deg, #1a0507 0%, #4d0a10 100%)' },
  { id: 'forest',       label: 'Forest',        value: 'linear-gradient(135deg, #0a1a0d 0%, #0d3320 100%)' },
  { id: 'galaxy',       label: 'Galaxy',        value: 'linear-gradient(135deg, #060612 0%, #100840 50%, #1a0530 100%)' },
  { id: 'sunset',       label: 'Void Ember',    value: 'linear-gradient(135deg, #1a0800 0%, #2d0e00 50%, #400020 100%)' },
  { id: 'slate',        label: 'Slate',         value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
  { id: 'aurora',       label: 'Aurora',        value: 'linear-gradient(135deg, #000a10 0%, #002244 50%, #004422 100%)' },
];

export const THEME_ACCENT_COLORS = {
  default: '#4da3ff',
  crimson: '#ff6b6b',
  emerald: '#34d399',
  violet:  '#a78bfa',
  gold:    '#fbbf24',
  shadow:  '#818cf8',
  sand:    '#c4963a',
  pure:    '#2563eb',
  paper:   '#6366f1',
  rose:    '#db2777',
};
