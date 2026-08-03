import { createClient } from '@supabase/supabase-js';

let client = null;

function clean(value) {
  return String(value || '').trim();
}

export function getSupabaseConfiguration() {
  const environment = import.meta.env || {};
  const url = clean(environment.VITE_SUPABASE_URL);
  const anonKey = clean(environment.VITE_SUPABASE_ANON_KEY);
  const configured = /^https:\/\//i.test(url) && anonKey.length >= 32;
  return Object.freeze({ configured, url, anonKey });
}

export function getSupabaseClient() {
  const configuration = getSupabaseConfiguration();
  if (!configuration.configured) return null;
  if (!client) {
    client = createClient(configuration.url, configuration.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 4 } },
      global: { headers: { 'x-application-name': 'tapestry-mobile-companion' } },
    });
  }
  return client;
}

export default getSupabaseClient;
