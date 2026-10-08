import { supabase, supabaseConfig } from '../auth/supabase'
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
/** The last access token seen. When the page is leaving there is no time to ask
 *  for one, so the final write uses whichever was current at the last flush. */
let lastToken: string | null = null

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  if (data.session) lastToken = data.session.access_token
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

/**
 * The page is going away: a refresh, a closed tab, a switch to another tab.
 *
 * Nothing async can be waited for now, and an ordinary request is abandoned
 * with the page, which loses whatever happened since the last timed flush. So
 * this is one request made by hand with `keepalive`, which the browser finishes
 * even as the page unloads. Browsers cap such a request at 64 KB, so a very long
 * log falls back to the ordinary path and is written on a best-effort basis.
 */
function flushOnExit(): void {
  if (!supabaseConfig || !sessionId || !lastToken) return
  const body = JSON.stringify(snapshot())
  if (body.length > 60_000) {
    void flushSession()
    return
  }
  void fetch(`${supabaseConfig.url}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    keepalive: true,
    headers: {
      apikey: supabaseConfig.key,
      Authorization: `Bearer ${lastToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body,
  }).catch(() => {
    // Best effort, and there is nobody left to tell.
  })
}

function onVisibility() {
  if (document.visibilityState === 'hidden') flushOnExit()
}

/** Starts recording for the signed-in learner. Idempotent. */
export function startSessionRecording(): void {
  if (!supabase || timer != null) return
  timer = window.setInterval(() => void flushSession(), FLUSH_MS)
  document.addEventListener('visibilitychange', onVisibility)
  // On a refresh or a close the page is not "hidden" yet when this fires, so it
  // must not wait for that.
  window.addEventListener('pagehide', flushOnExit)
  void flushSession()
}

/** Stops recording and writes one last time. Called on sign-out. */
export function stopSessionRecording(): void {
  if (timer != null) window.clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pagehide', flushOnExit)
  void flushSession()
  sessionId = null
}

/** A new session row from here on — the old one keeps what it already has. */
export function beginNewSession(): void {
  sessionId = null
}

