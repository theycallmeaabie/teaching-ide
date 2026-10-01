import type { Session } from '@supabase/supabase-js'
import { clearProgress, loadProgress } from '../data/progress'
import { beginNewSession, startSessionRecording, stopSessionRecording } from '../data/sessions'
import { useStore } from '../store'
import { supabase } from './supabase'

/**
 * Drives everything that depends on who is signed in: restoring progress and
 * recording the session log.
 *
 * When Supabase is unconfigured this settles immediately into the signed-out
 * state and nothing else happens, which is the behaviour the app had before
 * auth existed.
 */

let applied: string | null = null

async function apply(session: Session | null) {
  const store = useStore.getState()
  const id = session?.user.id ?? null

  if (id === applied) {
    store.set({ authReady: true })
    return
  }
  applied = id

  if (!id) {
    stopSessionRecording()
    clearProgress()
    store.set({ user: null, authReady: true })
    return
  }

  store.set({
    user: { id, email: session?.user.email ?? null },
    authReady: true,
  })
  await loadProgress()
  beginNewSession()
  startSessionRecording()
}

/** Call once at boot. Returns a teardown for the auth subscription. */
export function initAuth(): () => void {
  if (!supabase) {
    useStore.getState().set({ authReady: true })
    return () => {}
  }

  void supabase.auth.getSession().then(({ data }) => void apply(data.session))
  const { data } = supabase.auth.onAuthStateChange((_event, session) => void apply(session))

  return () => data.subscription.unsubscribe()
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sign-in is not configured.'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error?.message ?? null
}

export async function signUp(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sign-up is not configured.'
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return error.message
  // Projects with email confirmation on return a user but no session.
  if (!data.session) return 'Check your email to confirm the account, then sign in.'
  return null
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}
