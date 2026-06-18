import { createClient } from '@supabase/supabase-js'
import { config } from '@/config/config.js'

// anon client — used for auth operations (signInWithPassword, etc.)
export const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

// service role client — bypasses RLS, used for admin operations
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
