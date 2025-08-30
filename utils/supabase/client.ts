// utils/supabase/client.ts
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// HMR-safe global cache so we only ever have ONE GoTrue client in the browser
declare global {
  // eslint-disable-next-line no-var
  var __sbClient__: SupabaseClient | undefined;
}

export function createClient(): SupabaseClient {
  if (!url || !anon) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  if (!globalThis.__sbClient__) {
    globalThis.__sbClient__ = createSupabaseClient(url, anon, {
      auth: {
        persistSession: true,
        storageKey: 'sb-bizmap-auth', // unique to your app so it doesn't collide
      },
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[supabase] created browser client');
    }
  }
  return globalThis.__sbClient__!;
}

