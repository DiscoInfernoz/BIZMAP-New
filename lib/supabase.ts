import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// HMR-safe cache on globalThis
const g = globalThis as unknown as { __sb?: SupabaseClient };

export function getSupabaseBrowser(): SupabaseClient {
  if (!url || !anon) throw new Error('Missing Supabase env vars');

  if (!g.__sb) {
    g.__sb = createClient(url, anon, {
      auth: {
        persistSession: true,
        storageKey: 'sb-bizmap-auth', // pick a unique name for your app
      },
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[supabase] created browser client');
    }
  }
  return g.__sb!;
}
