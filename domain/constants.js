export const DATA_SCHEMA_VERSION = 27;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

export const STRING_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STORES = {
  task: 'tasks',
  taskCompletionEvent: 'taskCompletionEvents',
  taskCompletionReceipt: 'taskCompletionReceipts',
  achievementEvent: 'achievementEvents',
  achievementState: 'achievementStates',
  achievementReceipt: 'achievementReceipts',
  recommenderEvent: 'taskRecommendations',
  analyticsEvent: 'analyticsEvents',
  journal: 'journals',
  player: 'players',
  profileSummary: 'profileSummaries',
  event: 'events',
  shop: 'shop',
  todo: 'todos',
  transaction: 'transactions',
  inventory: 'inventory',
  match: 'matches',
  backgroundJob: 'backgroundJobs',
  backgroundJobReceipt: 'backgroundJobReceipts',
  friendship: 'friendships',
  notification: 'notifications',
  journalComment: 'journalComments',
  notes: 'notes',
  project: 'projects',
  customEvent: 'customEvents',
  eventLog: 'eventLogs',
  eventBuff: 'eventBuffs',
  contribution: 'contributions',
  resource: 'resources',
  reminder: 'reminders',
  appSetting: 'appSettings',
  derivedCache: 'derivedCaches',
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
  item_use: 'item_use',
};

export const SPECIAL_EVENT_IDS = {
  wakeTime:       'special-wake-time',
  sleepTime:      'special-sleep-time',
  firstMatch:     'special-first-match',
  entertainment:  'special-entertainment',
  dojoMultiplier: 'special-dojo-multiplier',
};

export const SPECIAL_KIND = {
  wake_time:       'wake_time',
  sleep_time:      'sleep_time',
  first_match:     'first_match',
  entertainment:   'entertainment',
  dojo_multiplier: 'dojo_multiplier',
};

// Decay rates for special events (in ms). On-target = full ceiling, decays exponentially.
//
// Note: the dojo_multiplier kind is intentionally absent from this tuning table —
// it is not a decay-curve special, it's an accumulator. Its value is computed
// per-task as (taskWeight × hoursWorked) and added into the existing buff entry,
// then cleared on the next match conclude. See applyDojoContribution / clearDojoMultiplier.
export const SPECIAL_EVENT_TUNING = {
  wake_time:     { timingCeiling: 0.15, checklistCeiling: 0.10, decayMs: 30 * 60 * 1000 },
  sleep_time:    { timingCeiling: 0.15, checklistCeiling: 0.10, decayMs: 30 * 60 * 1000 },
  first_match:   { ceiling: 0.12, decayMs: 2 * 60 * 60 * 1000 }, // 2-hour half-life
  entertainment: { flatBonus: 0.05 },                            // flat 1.05× when fired
};

// Hard cap on streak contribution to multiplier (days beyond don't increase but maintain).
export const HABIT_STREAK_CAP_DAYS = 30;

export const ITEM_TYPE = {
  duration: 'duration',
  quantity: 'quantity',
  cosmetic_theme: 'cosmetic_theme',
  cosmetic_title: 'cosmetic_title',
  cosmetic_banner: 'cosmetic_banner',
  cosmetic_card_banner: 'cosmetic_card_banner',
  cosmetic_profile_banner: 'cosmetic_profile_banner',
  cosmetic_lobby_banner: 'cosmetic_lobby_banner',
  cosmetic_profile_block: 'cosmetic_profile_block',
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

export const COSMETIC_TITLES = [
  {
    id: 'gold',
    label: 'Gold',
    cost: 1000,
    source: 'shop',
    color: '#fbbf24',
    accent: '#fde68a',
    description: 'A clean gold title for your profile identity.',
  },
  {
    id: 'wealthy',
    label: 'Wealthy',
    cost: 10000,
    source: 'shop',
    color: '#fbbf24',
    accent: '#fff7ad',
    glow: true,
    description: 'A radiant gold title with a prestige glow.',
  },
  {
    id: 'wayfinder',
    label: 'Wayfinder',
    source: 'contribution',
    color: '#38bdf8',
    accent: '#bae6fd',
    description: 'Unlocked by early Contribution Trail progress.',
  },
  {
    id: 'builder',
    label: 'Builder',
    source: 'contribution',
    color: '#34d399',
    accent: '#bbf7d0',
    description: 'Unlocked by sustained Goal contribution.',
  },
  {
    id: 'momentum',
    label: 'Momentum',
    source: 'contribution',
    color: '#a78bfa',
    accent: '#ddd6fe',
    description: 'Unlocked when your trail starts to compound.',
  },
  {
    id: 'trailkeeper',
    label: 'Trailkeeper',
    source: 'contribution',
    color: '#f59e0b',
    accent: '#fde68a',
    description: 'Unlocked for long-running Contribution Trail consistency.',
  },
  {
    id: 'vanguard',
    label: 'Vanguard',
    source: 'contribution',
    color: '#fb7185',
    accent: '#fecdd3',
    description: 'Unlocked deep into the Contribution Trail.',
  },
  {
    id: 'everbright',
    label: 'Everbright',
    source: 'contribution',
    color: '#fef08a',
    accent: '#ffffff',
    glow: true,
    description: 'The glowing final title of the extended Contribution Trail.',
  },
];

export const COSMETIC_PASSES = [
  { id: 'card_banner',    type: 'cosmetic_card_banner',    label: 'Card Banner Pass',    cost: 750,  icon: '◉', desc: 'Customize your player card look in arena matches.' },
  { id: 'profile_banner', type: 'cosmetic_profile_banner', label: 'Profile Banner Pass', cost: 600,  icon: '⬡', desc: 'Set a custom background gradient or image on your profile page.' },
  { id: 'lobby_banner',   type: 'cosmetic_lobby_banner',   label: 'Lobby Banner Pass',   cost: 500,  icon: '◈', desc: 'Set a custom background image on your lobby player card.' },
];

export const COSMETIC_PROFILE_BLOCKS = [
  { id: 'profile_block_rank_graph', type: 'cosmetic_profile_block', blockType: 'rankGraph', label: 'Rank Graph Block', cost: 450, icon: '⌁', desc: 'Add a responsive ELO rank graph to your profile.' },
  { id: 'profile_block_stats', type: 'cosmetic_profile_block', blockType: 'stats', label: 'Career Snapshot Block', cost: 300, icon: '▦', desc: 'Display your career totals and profile statistics.' },
  { id: 'profile_block_achievements', type: 'cosmetic_profile_block', blockType: 'achievements', label: 'Achievement Shelf Block', cost: 350, icon: '◇', desc: 'Show selected and earned achievements on your profile.' },
  { id: 'profile_block_highlights', type: 'cosmetic_profile_block', blockType: 'highlights', label: 'Highlights Block', cost: 300, icon: '✦', desc: 'Show recent highlights from your activity.' },
  { id: 'profile_block_activity', type: 'cosmetic_profile_block', blockType: 'activity', label: 'Recent Activity Block', cost: 400, icon: '≡', desc: 'Add a compact feed of recent profile activity.' },
  { id: 'profile_block_contribution', type: 'cosmetic_profile_block', blockType: 'goalContribution', label: 'Goal Contribution Block', cost: 0, icon: '◔', desc: 'Show a donut chart of the Goals you contribute to most.' },
];

export const CONTRIBUTION_PASS_REWARDS = [
  {
    id: 'pass-start',
    threshold: 0,
    label: 'Steel Blue',
    rewardType: 'Theme',
    description: 'The default theme is available from the start.',
    items: [{ id: 'default', type: ITEM_TYPE.cosmetic_theme, label: 'Steel Blue' }],
  },
  {
    id: 'pass-5',
    threshold: 5,
    label: 'Pure White',
    rewardType: 'Theme',
    description: 'A clean light theme for early Goal progress.',
    items: [{ id: 'pure', type: ITEM_TYPE.cosmetic_theme, label: 'Pure White' }],
  },
  {
    id: 'pass-10',
    threshold: 10,
    label: 'Crimson Pair',
    rewardType: 'Theme Pair',
    description: 'Crimson and Rose Quartz unlock together.',
    items: [
      { id: 'crimson', type: ITEM_TYPE.cosmetic_theme, label: 'Crimson' },
      { id: 'rose', type: ITEM_TYPE.cosmetic_theme, label: 'Rose Quartz' },
    ],
  },
  {
    id: 'pass-20',
    threshold: 20,
    label: 'Wayfinder',
    rewardType: 'Title',
    description: 'A crisp title for early Contribution Trail momentum.',
    items: [{ id: 'wayfinder', type: ITEM_TYPE.cosmetic_title, label: 'Wayfinder' }],
  },
  {
    id: 'pass-30',
    threshold: 30,
    label: 'Emerald Pair',
    rewardType: 'Theme Pair',
    description: 'Emerald and Sandy themes.',
    items: [
      { id: 'emerald', type: ITEM_TYPE.cosmetic_theme, label: 'Emerald' },
      { id: 'sand', type: ITEM_TYPE.cosmetic_theme, label: 'Sandy' },
    ],
  },
  {
    id: 'pass-50',
    threshold: 50,
    label: 'Card Banner Pass',
    rewardType: 'Banner Pass',
    description: 'Customize your arena player card.',
    items: [{ id: 'card_banner', type: ITEM_TYPE.cosmetic_card_banner, label: 'Card Banner Pass' }],
  },
  {
    id: 'pass-75',
    threshold: 75,
    label: 'Builder',
    rewardType: 'Title',
    description: 'A title for steady Goal construction.',
    items: [{ id: 'builder', type: ITEM_TYPE.cosmetic_title, label: 'Builder' }],
  },
  {
    id: 'pass-100',
    threshold: 100,
    label: 'Goal Contribution',
    rewardType: 'Profile Block',
    description: 'Display your Contribution split by Goal.',
    items: [{ id: 'profile_block_contribution', type: ITEM_TYPE.cosmetic_profile_block, label: 'Goal Contribution Block' }],
  },
  {
    id: 'pass-150',
    threshold: 150,
    label: 'Violet Studio',
    rewardType: 'Cosmetic Bundle',
    description: 'Violet, Paper, and the Momentum title.',
    items: [
      { id: 'violet', type: ITEM_TYPE.cosmetic_theme, label: 'Violet' },
      { id: 'paper', type: ITEM_TYPE.cosmetic_theme, label: 'Paper' },
      { id: 'momentum', type: ITEM_TYPE.cosmetic_title, label: 'Momentum' },
    ],
  },
  {
    id: 'pass-250',
    threshold: 250,
    label: 'Lobby Identity',
    rewardType: 'Pass + Title',
    description: 'Lobby Banner Pass and the Trailkeeper title.',
    items: [
      { id: 'lobby_banner', type: ITEM_TYPE.cosmetic_lobby_banner, label: 'Lobby Banner Pass' },
      { id: 'trailkeeper', type: ITEM_TYPE.cosmetic_title, label: 'Trailkeeper' },
    ],
  },
  {
    id: 'pass-500',
    threshold: 500,
    label: 'Profile Architect',
    rewardType: 'Profile Bundle',
    description: 'Profile Banner Pass, Rank Graph, and Career Snapshot.',
    items: [
      { id: 'profile_banner', type: ITEM_TYPE.cosmetic_profile_banner, label: 'Profile Banner Pass' },
      { id: 'profile_block_rank_graph', type: ITEM_TYPE.cosmetic_profile_block, label: 'Rank Graph Block' },
      { id: 'profile_block_stats', type: ITEM_TYPE.cosmetic_profile_block, label: 'Career Snapshot Block' },
    ],
  },
  {
    id: 'pass-750',
    threshold: 750,
    label: 'Shadow Archive',
    rewardType: 'Prestige Bundle',
    description: 'Shadow Black, Vanguard, and Recent Activity.',
    items: [
      { id: 'shadow', type: ITEM_TYPE.cosmetic_theme, label: 'Shadow Black' },
      { id: 'vanguard', type: ITEM_TYPE.cosmetic_title, label: 'Vanguard' },
      { id: 'profile_block_activity', type: ITEM_TYPE.cosmetic_profile_block, label: 'Recent Activity Block' },
    ],
  },
  {
    id: 'pass-1000',
    threshold: 1000,
    label: 'Gold Emperor',
    rewardType: 'Prestige Reward',
    description: 'The Gold Emperor theme plus the Achievement Shelf and Highlights blocks.',
    items: [
      { id: 'gold', type: ITEM_TYPE.cosmetic_theme, label: 'Gold Emperor' },
      { id: 'profile_block_achievements', type: ITEM_TYPE.cosmetic_profile_block, label: 'Achievement Shelf Block' },
      { id: 'profile_block_highlights', type: ITEM_TYPE.cosmetic_profile_block, label: 'Highlights Block' },
    ],
  },
  {
    id: 'pass-1500',
    threshold: 1500,
    label: 'Everbright',
    rewardType: 'Glowing Title',
    description: 'The extended Contribution Trail finale.',
    items: [{ id: 'everbright', type: ITEM_TYPE.cosmetic_title, label: 'Everbright' }],
  },
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
// Penalty / ban system
export const MAX_PENALTY_STRIKES = 15;
