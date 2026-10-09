import { useCallback, useEffect, useRef, useState } from 'react'
import { accessToken } from '../auth/supabase'
import { apiUrl } from '../api'
import { hush } from '../teacher/voice'

/**
 * Ask by voice: record in the browser, have the server turn it into words, hand
 * the words to the caller. Nothing is sent to the teacher from here: the words
 * land in the ask box and the learner reads them first, because speech-to-text
 * mangles code ("colon" is not "Colin") and a wrong question misleads the teacher.
 *
 * The microphone is open only while the learner has asked it to be: it is
 * released the moment recording stops, so the browser's recording indicator goes
 * out with it.
 */

export type VoiceState = 'idle' | 'starting' | 'recording' | 'transcribing'

/** A minute is a long question. It also keeps the upload small. */
const MAX_MS = 60_000
/** Shorter than this is a click, not a question. */
const MIN_MS = 600
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function voiceSupport(): { ok: true } | { ok: false; why: string } {
  if (!window.isSecureContext) return { ok: false, why: 'Voice needs a secure page (https or localhost)' }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { ok: false, why: "This browser can't record audio. Type your question instead" }
  }
  return { ok: true }
}

function micMessage(e: unknown): string {
  switch ((e as { name?: string })?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The microphone is blocked. Allow it from the address bar, then try again'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found'
    case 'NotReadableError':
      return 'The microphone is being used by another app'
    default:
      return "Couldn't start the microphone"
  }
}

/** The server words its refusals for a learner, so show them as they are. */
async function serverMessage(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') detail = body.detail
  } catch {
    /* not JSON: fall through to the generic wording */
  }
  if (res.status === 429 || res.status === 413 || res.status === 400) return detail || 'Try that again in a moment'
  if (res.status === 415 || res.status === 422) return "Couldn't read that recording. Try again"
  return "Voice isn't available right now. You can still type your question"
}

type Active = {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  startedAt: number
  cancelled: boolean
}

export function useVoice(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  const active = useRef<Active | null>(null)
  const abort = useRef<AbortController | null>(null)
  const timers = useRef<{ limit?: number; tick?: number; note?: number }>({})
  const alive = useRef(true)
  const stateRef = useRef<VoiceState>('idle')
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const go = useCallback((s: VoiceState) => {
    stateRef.current = s
    setState(s)
  }, [])

  const clearTimers = () => {
    window.clearTimeout(timers.current.limit)
    window.clearInterval(timers.current.tick)
    timers.current.limit = timers.current.tick = undefined
  }

  /** Let go of the microphone. Safe to call twice. */
  const release = useCallback(() => {
    clearTimers()
    active.current?.stream.getTracks().forEach((t) => t.stop())
    active.current = null
  }, [])

  const say = useCallback((message: string | null) => {
    window.clearTimeout(timers.current.note)
    setError(message)
    if (message) timers.current.note = window.setTimeout(() => alive.current && setError(null), 8000)
  }, [])

  const fail = useCallback(
    (message: string) => {
      release()
      go('idle')
      say(message)
    },
    [release, go, say],
  )

  const transcribe = useCallback(
    async (blob: Blob) => {
      go('transcribing')
      const ctl = new AbortController()
      abort.current = ctl
      const timeout = window.setTimeout(() => ctl.abort(), 30_000)
      try {
        const token = await accessToken()
        const res = await fetch(apiUrl('/api/transcribe'), {
          method: 'POST',
          headers: {
            'Content-Type': blob.type || 'audio/webm',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: blob,
          signal: ctl.signal,
        })
        if (!alive.current || ctl.signal.aborted) return
        if (!res.ok) return fail(await serverMessage(res))
        const { text } = (await res.json()) as { text?: string }
        const spoken = (text ?? '').trim()
        if (!spoken) return fail("I didn't catch anything. Try again, a little closer to the mic")
        go('idle')
        onTextRef.current(spoken)
      } catch {
        if (!alive.current) return
        if (ctl.signal.aborted) go('idle') // cancelled on purpose: nothing to apologise for
        else fail("Couldn't reach the server. You can still type your question")
      } finally {
        window.clearTimeout(timeout)
        if (abort.current === ctl) abort.current = null
      }
    },
    [fail, go],
  )

  const stop = useCallback(() => {
    const a = active.current
    if (a && a.recorder.state !== 'inactive') a.recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    if (stateRef.current === 'recording' && active.current) {
      active.current.cancelled = true
      stop()
    } else if (stateRef.current === 'transcribing') {
      abort.current?.abort()
    }
  }, [stop])

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return
    const support = voiceSupport()
    if (!support.ok) return say(support.why)

    say(null)
    hush() // or the microphone hears the teacher instead of the question
    go('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
    } catch (e) {
      return fail(micMessage(e))
    }
    if (!alive.current) return stream.getTracks().forEach((t) => t.stop())

    let recorder: MediaRecorder
    try {
      const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
      recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      return fail("This browser can't record audio. Type your question instead")
    }

    const a: Active = { recorder, stream, chunks: [], startedAt: performance.now(), cancelled: false }
    active.current = a
    recorder.ondataavailable = (e) => e.data.size > 0 && a.chunks.push(e.data)
    recorder.onerror = () => fail("Recording stopped unexpectedly. Try again")
    recorder.onstop = () => {
      const elapsed = performance.now() - a.startedAt
      const blob = new Blob(a.chunks, { type: recorder.mimeType || 'audio/webm' })
      release()
      if (!alive.current) return
      if (a.cancelled) return go('idle')
      if (elapsed < MIN_MS || blob.size === 0) return fail('That was too short. Click the mic, ask, then click it again')
      void transcribe(blob)
    }

    recorder.start()
    setSeconds(0)
    go('recording')
    timers.current.tick = window.setInterval(() => setSeconds(Math.floor((performance.now() - a.startedAt) / 1000)), 250)
    timers.current.limit = window.setTimeout(stop, MAX_MS)
  }, [fail, go, release, say, stop, transcribe])

  // Escape abandons a recording (or a transcription in flight) without sending it.
  useEffect(() => {
    if (state !== 'recording' && state !== 'transcribing') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, cancel])

  // Leaving the page, or the box, must never leave a microphone open.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      abort.current?.abort()
      const a = active.current
      if (a) {
        a.cancelled = true
        if (a.recorder.state !== 'inactive') a.recorder.stop()
      }
      release()
      window.clearTimeout(timers.current.note)
    }
  }, [release])

  return { state, error, seconds, start, stop, cancel }
}
