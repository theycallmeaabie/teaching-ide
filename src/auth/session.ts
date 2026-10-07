import type { Session } from '@supabase/supabase-js'
import { clearProgress, loadProgress } from '../data/progress'
import { beginNewSession, flushSession, startSessionRecording, stopSessionRecording } from '../data/sessions'
import { EXERCISES } from '../lesson/exercises'
import * as observer from '../observer/observer'
import { useStore } from '../store'
import { cancelTeaching } from '../teacher/bridge'
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

/**
 * Somebody else is about to sit down. Everything that belonged to the last
 * learner goes: their ticks, their place on the ladder, their conversation, the
 * code on screen — and the observer's event log, or it would be written into
 * the next person's session row.
 */
function resetLearner() {
  cancelTeaching()
  const s = useStore.getState()
  s.set({
    exerciseIndex: 0,
    bufferEpoch: s.bufferEpoch + 1,
    solved: EXERCISES.map(() => false),
    attempts: 0,
    tier: 1,
    hintsGiven: 0,
    askedForAnswer: 0,
    seen: [],
    recent: [],
    speech: null,
    misconceptions: [],
    lastResult: null,
    errorPlain: null,
    lastSilence: null,
  })
  observer.resetSession()
  observer.setStarter(EXERCISES[0].starter)
  observer.setTeachingState(1, 0)
}

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
    resetLearner()
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
  // Write the session log while there is still a session to write it with. By
  // the time the sign-out event fires the token is gone, so a flush from there
  // is refused and the last stretch of the log would be lost.
  await flushSession()
  await supabase.auth.signOut()
}
