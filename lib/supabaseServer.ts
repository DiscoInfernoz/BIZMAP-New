// lib/supabaseServer.ts
import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client (uses SERVICE ROLE key).
 * Do NOT import this in client components.
 */
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
