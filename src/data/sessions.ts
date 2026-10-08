import { supabase } from '../auth/supabase'
import { config } from '../observer/config'
import * as log from '../observer/log'
import { EXERCISES } from '../lesson/exercises'
import { useStore } from '../store'

/**
 * Server-side session recording.
 *
 * `Export log` in the dev panel already writes the evidence to a file, but it
 * depends on somebody remembering to click it. These are the sessions the
 * premise is judged on, so they get written whether anyone remembers or not:
 * one row per session, upserted on a timer and again when the tab goes away.
 *
 * A failed flush is swallowed. Losing the recording is bad; interrupting a
 * learner mid-exercise to tell them about it is worse.
 */

const FLUSH_MS = 20_000

let sessionId: string | null = null
let timer: number | null = null
let flushing = false

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function snapshot() {
  const exported = log.exportJson({ ...config })
  const s = useStore.getState()
  return {
    started_at: exported.sessionStartedAt,
    duration_ms: exported.durationMs,
    exercise_id: EXERCISES[s.exerciseIndex]?.id ?? null,
    config: exported.config,
    events: exported.events,
    event_count: exported.events.length,
  }
}

/** Writes the log as it currently stands. Safe to call at any time. */
export async function flushSession(): Promise<void> {
  const userId = await currentUserId()
  if (!supabase || !userId || flushing) return
  flushing = true
  try {
    const row = snapshot()
    if (sessionId) {
      const { error } = await supabase.from('sessions').update(row).eq('id', sessionId)
      if (error) console.warn('sessions: could not update', error.message)
    } else {
      const { data, error } = await supabase
        .from('sessions')
        .insert({ ...row, user_id: userId })
        .select('id')
        .single()
      if (error) console.warn('sessions: could not create', error.message)
      sessionId = (data as { id: string } | null)?.id ?? null
    }
  } catch {
    // Deliberate: recording is best-effort, the lesson is not.
  } finally {
    flushing = false
  }
}

/** Starts recording for the signed-in learner. Idempotent. */
export function startSessionRecording(): void {
  if (!supabase || timer != null) return
  timer = window.setInterval(() => void flushSession(), FLUSH_MS)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)
  void flushSession()
}

/** Stops recording and writes one last time. Called on sign-out. */
export function stopSessionRecording(): void {
  if (timer != null) window.clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onHide)
  window.removeEventListener('pagehide', onHide)
  void flushSession()
  sessionId = null
}

/** A new session row from here on — the old one keeps what it already has. */
export function beginNewSession(): void {
  sessionId = null
}

function onHide() {
  if (document.visibilityState === 'hidden') void flushSession()
}
