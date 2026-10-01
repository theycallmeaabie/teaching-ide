import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase client, or `null` when the project is not configured.
 *
 * Null is a supported state, not a failure. The editor, the observer, the
 * whole hint ladder and the pre-written fallbacks all work with no backend at
 * all; signing in adds persistence on top. Every caller in `src/data/` checks
 * for null and degrades to in-memory rather than throwing, because a learner
 * who cannot reach Supabase should still get their lesson.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null

/** True when `.env` carries a project. The UI hides the sign-in bar otherwise. */
export const authConfigured = supabase !== null

export type AuthUser = { id: string; email: string | null }

/** The access token for the current session, for the `Authorization` header on
 *  `/api/teach`. Null when signed out or unconfigured — the server treats that
 *  as an anonymous call rather than rejecting it. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
