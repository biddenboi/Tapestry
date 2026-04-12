
import { createClient } from '@supabase/supabase-js';

// ── Replace these two values with your project's values ──────────────────
// Found in: Supabase dashboard → Project Settings → API
export const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
// ─────────────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n' +
    'Create a .env file at the project root with:\n' +
    '  VITE_SUPABASE_URL=https://your-project.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=your-anon-key'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);