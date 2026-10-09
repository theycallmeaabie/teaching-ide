import { accessToken } from '../auth/supabase'
import { apiUrl } from '../api'
import { useStore, type Speech } from '../store'
import { readPref, writePref } from '../ui/prefs'
import { sentences, spoken } from './spoken'

/**
 * The teacher, read aloud.
 *
 * The voice is ElevenLabs, through the API (POST /api/speak), so it sounds the
 * same on every device. When that cannot be had (no key on the server, the
 * credits used up, the API asleep or down, a limit hit) the browser's own speech
 * engine reads it instead: a different voice, never silence. That fallback needs
 * no server at all, so the pre-written hints are read even with the backend down.
 *
 * Off until the learner turns it on, and the choice is remembered. A teacher that
 * starts talking unasked is not welcome in a classroom, and a browser will not
 * let a page make sound before someone has clicked something anyway.
 *
 * Each thing the teacher says is read once, when it has all arrived (the text
 * appears a little at a time, and reading half a sentence would be worse than
 * waiting), and reading stops the moment it is dismissed or replaced: a teacher
 * still talking about code the learner has moved on from is wrong out loud.
 */

const KEY = 'teaching-ide:voice'
const RATE = 1

/** Said when the voice is turned on and there is nothing on screen to read, so
 *  the learner hears straight away what they turned on. */
const HELLO = "I'll read my hints out loud."

/** Longer than this and the browser's voice starts instead. A sleeping API takes
 *  a minute to wake, and a hint read a minute late is about code already changed. */
const SERVER_TIMEOUT_MS = 8000
/** The server has no voice to give (no key, no credits, refused) or has spent
 *  today's: stop asking for a while, since each try only delays the fallback. */
const LASTING = new Set(['unconfigured', 'no_credits', 'refused', 'budget'])
const SERVER_BACKOFF_MS = 10 * 60_000

const hasBrowserVoice = () =>
  typeof window !== 'undefined' && !!window.speechSynthesis && typeof SpeechSynthesisUtterance === 'function'

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && (typeof Audio === 'function' || hasBrowserVoice())
}

let on = voiceSupported() && readPref(KEY) === '1'
const listeners = new Set<() => void>()

export const voiceOn = () => on

export function subscribeVoice(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The speech being read, so the same thing is never read twice. */
let readingId: number | null = null
/** Bumped by everything new to say and by every hush, so work that finishes
 *  late (a clip that took a second to arrive) can tell it is no longer wanted. */
let generation = 0
let serverOffUntil = 0
let fetching: AbortController | null = null
/** One element for every clip: Safari lets a page play sound later only on an
 *  element that has already played during a click. */
let player: HTMLAudioElement | null = null
let clipUrl: string | null = null
/** Chrome stops reporting on an utterance it has let go of, so keep hold of them. */
const held: SpeechSynthesisUtterance[] = []

// ------------------------------------------------------------------ ElevenLabs

async function fetchClip(text: string): Promise<Blob | null> {
  const ctl = new AbortController()
  fetching = ctl
  const timer = window.setTimeout(() => ctl.abort(), SERVER_TIMEOUT_MS)
  try {
    const token = await accessToken()
    const res = await fetch(apiUrl('/api/speak'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text }),
      signal: ctl.signal,
    })
    if (res.ok) {
      const clip = await res.blob()
      return clip.size ? clip : null
    }
    const body = (await res.json().catch(() => null)) as { kind?: string } | null
    if (body?.kind && LASTING.has(body.kind)) serverOffUntil = Date.now() + SERVER_BACKOFF_MS
    return null
  } catch {
    return null // unreachable, slow, or hushed: the browser's voice, or nothing
  } finally {
    window.clearTimeout(timer)
    if (fetching === ctl) fetching = null
  }
}

function audio(): HTMLAudioElement {
  return (player ??= new Audio())
}

function releaseClip() {
  if (clipUrl) URL.revokeObjectURL(clipUrl)
  clipUrl = null
}

/** True if it started playing. */
async function play(clip: Blob): Promise<boolean> {
  const a = audio()
  releaseClip()
  clipUrl = URL.createObjectURL(clip)
  a.src = clipUrl
  try {
    await a.play()
    return true
  } catch {
    return false
  }
}

/** A tenth of a second of silence, played on the click that turns the voice
 *  on, so the element is allowed to play the clips that arrive later. */
function unlock() {
  const samples = 800 // 8 kHz, 8-bit mono
  const wav = new Uint8Array(44 + samples).fill(128, 44) // 8-bit PCM is unsigned: 128 is silence
  const v = new DataView(wav.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (wav[at + i] = c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVEfmt ')
  v.setUint32(16, 16, true) // the format block's size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, 8000, true) // samples a second
  v.setUint32(28, 8000, true) // bytes a second
  v.setUint16(32, 1, true) // bytes a sample
  v.setUint16(34, 8, true) // bits a sample
  ascii(36, 'data')
  v.setUint32(40, samples, true)
  void play(new Blob([wav], { type: 'audio/wav' }))
}

// ------------------------------------------------------- the browser's own voice

/** Novelty and robot voices some systems list alongside the ordinary ones. */
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|espeak/i

const norm = (lang: string) => lang.toLowerCase().replace('_', '-')

/** The best English voice this device has. The hints are English whatever the
 *  browser's language. */
function pickVoice(): SpeechSynthesisVoice | null {
  const english = window.speechSynthesis.getVoices().filter((v) => /^en\b/i.test(v.lang.replace('_', '-')))
  const want = norm(navigator.language || 'en-US')
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online/i.test(v.name) ? 8 : 0) + // Edge and Windows: the best of them
    (/google/i.test(v.name) ? 6 : 0) + // Chrome's own
    (/premium|enhanced/i.test(v.name) ? 6 : 0) + // macOS, once downloaded
    (norm(v.lang) === want ? 3 : 0) +
    (v.default ? 1 : 0) -
    (NOVELTY.test(v.name) ? 20 : 0)
  return english.sort((a, b) => score(b) - score(a))[0] ?? null
}

function sayInBrowser(text: string) {
  if (!hasBrowserVoice()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const voice = pickVoice()
  held.length = 0
  for (const piece of sentences(text)) {
    const u = new SpeechSynthesisUtterance(piece)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? 'en-US'
    u.rate = RATE
    held.push(u)
    synth.speak(u)
  }
}

// ------------------------------------------------------------------ speaking

/** Stop whatever is being said or fetched, without forgetting what it was. */
function stop() {
  fetching?.abort()
  fetching = null
  player?.pause()
  releaseClip()
  held.length = 0
  if (hasBrowserVoice()) window.speechSynthesis.cancel()
}

async function say(text: string) {
  const mine = ++generation
  stop()
  if (Date.now() >= serverOffUntil) {
    const clip = await fetchClip(text)
    if (mine !== generation) return // hushed or replaced while it was on its way
    if (clip && (await play(clip))) return
    if (mine !== generation) return
  }
  sayInBrowser(text)
}

function read(s: Speech) {
  readingId = s.id
  void say([s.text, s.followup].filter(Boolean).map((t) => spoken(t!)).join(' '))
}

/** Stop talking, now. Safe to call when nothing is being said. */
export function hush() {
  if (!voiceSupported()) return
  generation++
  readingId = null
  stop()
}

export function setVoiceOn(next: boolean) {
  if (!voiceSupported()) return
  on = next
  writePref(KEY, next ? '1' : '0')
  for (const l of listeners) l()
  if (!next) return hush()
  // The click that turned it on is what lets the page make sound, so use it.
  if (typeof Audio === 'function') unlock()
  const s = useStore.getState().speech
  if (s && s.text && !s.streaming) read(s)
  else void say(HELLO)
}

/**
 * Read what the teacher says, for as long as the lesson is open. Returns the way
 * to stop, which also stops anything being said.
 */
export function followTeacher(): () => void {
  if (!voiceSupported()) return () => {}
  if (hasBrowserVoice()) window.speechSynthesis.getVoices() // some browsers load their voices only once asked
  const unsubscribe = useStore.subscribe((st, prev) => {
    const s = st.speech
    if (s === prev.speech) return
    if (readingId != null && s?.id !== readingId) hush() // dismissed, or replaced
    if (on && s && s.text && !s.streaming && s.id !== readingId) read(s)
  })
  return () => {
    unsubscribe()
    hush()
  }
}
