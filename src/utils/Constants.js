
// ── Store identifiers ─────────────────────────────────────────────────────────
// These are used as keys throughout the app. SupabaseConnection maps them
// to the correct Supabase table names internally.
export const STORES = {
  task:        'taskObjectStore',
  journal:     'journalObjectStore',
  player:      'playerObjectStore',
  todo:        'todoObjectStore',
  transaction: 'transactionObjectStore',
};

export const DAY         = 86400000;
export const WEEK        = 604800000;
export const MINUTE      = 60000;
export const SECOND      = 1000;
export const STRING_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];