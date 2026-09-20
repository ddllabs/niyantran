import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Resolve environment variables across Node.js (process.env) and Vite/browser (import.meta.env)
const env = (typeof process !== 'undefined' && process.env) 
  ? process.env 
  : ((typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {});

const SUPABASE_URL = 
  env.VITE_SUPABASE_URL || 
  env.SUPABASE_URL || 
  env.VITR_SUPABASE_URL || 
  "https://vfgcppstyzjarlzyqdac.supabase.co";

const SUPABASE_ANON_KEY = 
  env.VITE_SUPABASE_ANON_KEY || 
  env.SUPABASE_ANON_KEY || 
  env.VITE_SUPABASE_PUBLISHABLE_KEY || 
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
  "sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I";

const SUPABASE_SERVICE_ROLE_KEY = 
  env.SUPABASE_SERVICE_ROLE_KEY || 
  env.SERVICE_ROLE_KEY ||
  "";

/**
 * Standard anonymous Supabase client
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: typeof window !== 'undefined',
      autoRefreshToken: true,
    }
  }
);

/**
 * Admin Supabase client using service role key (bypasses RLS for server-side operations)
 */
export const getSupabaseAdmin = (): SupabaseClient<Database> => {
  const serviceKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  return createClient<Database>(SUPABASE_URL, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    }
  });
};
