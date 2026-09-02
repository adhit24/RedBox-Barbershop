import { createClient } from '@supabase/supabase-js';

// Supabase URL + publishable key are public browser configuration, not secrets.
// Prefer deployment env when present, but keep the same Redbox Supabase project as
// an explicit fallback so a missing Vite env can never crash Backoffice at startup.
const REDBOX_SUPABASE_URL = 'https://khcvklzxfohwkyocenaf.supabase.co';
const REDBOX_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zXzyWRuSjJbXYomkJ1ws8w_iHHq1LSg';

export const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  || REDBOX_SUPABASE_URL;

export const supabasePublishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
  || REDBOX_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
