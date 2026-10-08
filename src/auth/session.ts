import type { Session } from '@supabase/supabase-js'
import { clearProgress, loadProgress } from '../data/progress'
import { beginNewSession, flushSession, startSessionRecording, stopSessionRecording } from '../data/sessions'
import { EXERCISES } from '../lesson/exercises'
import * as observer from '../observer/observer'
import { useStore } from '../store'
import { cancelTeaching } from '../teacher/bridge'
import { writeGuest } from './guest'
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
    // Somebody signed out, so the next person is not a guest by inheritance:
    // they are asked. (Booting signed out never gets here: nothing changed.)
    writeGuest(false)
    store.set({ user: null, guest: false, authReady: true })
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

/** How long the first auth check may take before the app stops waiting for it. */
const AUTH_SETTLE_MS = 5000

/** Call once at boot. Returns a teardown for the auth subscription. */
export function initAuth(): () => void {
  if (!supabase) {
    useStore.getState().set({ authReady: true })
    return () => {}
  }

  // Every page waits on `authReady`, so a check that never comes back (offline,
  // a stalled token refresh) must not leave the app on a spinner for good. After
  // a while it carries on as signed out; if the answer does arrive, `apply` will
  // sign them in and the sign-in page walks them on.
  const settle = window.setTimeout(() => {
    if (!useStore.getState().authReady) useStore.getState().set({ authReady: true })
  }, AUTH_SETTLE_MS)

  // The second argument answers only a failed `getSession`. A `.catch` after the
  // first would also catch a failure inside `apply` and treat it as a sign-out.
  void supabase.auth
    .getSession()
    .then(
      ({ data }) => apply(data.session),
      () => apply(null),
    )
    .finally(() => window.clearTimeout(settle))
  const { data } = supabase.auth.onAuthStateChange((_event, session) => void apply(session))

  return () => {
    window.clearTimeout(settle)
    data.subscription.unsubscribe()
  }
}

/** They picked "Continue as guest": into the lesson, with nothing saved. */
export function continueAsGuest(): void {
  writeGuest(true)
  useStore.getState().set({ guest: true })
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sign-in is not configured.'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error?.message ?? null
}

/** `confirm` is true when the project wants the email confirmed first: the
 *  account exists but there is no session yet. False means they are in. */
export type SignUpResult = { error: string } | { confirm: boolean }

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  if (!supabase) return { error: 'Sign-up is not configured.' }
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: error.message }
  return { confirm: !data.session }
}

/** Sends the confirmation email again, for a sign-up that is waiting on one. */
export async function resendConfirmation(email: string): Promise<string | null> {
  if (!supabase) return 'Sign-up is not configured.'
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  return error?.message ?? null
}

/**
 * Emails a link that brings them back to `/reset-password` signed in just far
 * enough to choose a new password. The address must be among the project's
 * allowed redirect URLs (Supabase → Authentication → URL Configuration).
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  if (!supabase) return 'Password reset is not configured.'
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  return error?.message ?? null
}

/** Sets a new password for whoever holds the current session (the one the reset
 *  link just opened). */
export async function updatePassword(password: string): Promise<string | null> {
  if (!supabase) return 'Password reset is not configured.'
  const { error } = await supabase.auth.updateUser({ password })
  return error?.message ?? null
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  // Write the session log while there is still a session to write it with. By
  // the time the sign-out event fires the token is gone, so a flush from there
  // is refused and the last stretch of the log would be lost.
  await flushSession()
  await supabase.auth.signOut()
}
