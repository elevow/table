import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseBrowser: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (supabaseBrowser) return supabaseBrowser;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('Supabase URL or anon key not configured');
    return null;
  }

  supabaseBrowser = createClient(url, key);
  return supabaseBrowser;
}
