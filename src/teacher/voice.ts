import { useStore, type Speech } from '../store'
import { readPref, writePref } from '../ui/prefs'
import { sentences, spoken } from './spoken'

/**
 * The teacher, read aloud, by the browser's own speech engine: no server, no key,
 * no cost, and it works with the backend down, so the pre-written hints are read
 * too. How it sounds depends on the voices the device has.
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

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof SpeechSynthesisUtterance === 'function'
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
/** Chrome stops reporting on an utterance it has let go of, so keep hold of them. */
const held: SpeechSynthesisUtterance[] = []

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

function say(text: string) {
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

function read(s: Speech) {
  readingId = s.id
  say([s.text, s.followup].filter(Boolean).map((t) => spoken(t!)).join(' '))
}

/** Stop talking, now. Safe to call when nothing is being said. */
export function hush() {
  if (!voiceSupported()) return
  readingId = null
  held.length = 0
  window.speechSynthesis.cancel()
}

export function setVoiceOn(next: boolean) {
  if (!voiceSupported()) return
  on = next
  writePref(KEY, next ? '1' : '0')
  for (const l of listeners) l()
  if (!next) return hush()
  // The click that turned it on is what lets the page make sound, so use it.
  const s = useStore.getState().speech
  if (s && s.text && !s.streaming) read(s)
  else say(HELLO)
}

/**
 * Read what the teacher says, for as long as the lesson is open. Returns the way
 * to stop, which also stops anything being said.
 */
export function followTeacher(): () => void {
  if (!voiceSupported()) return () => {}
  window.speechSynthesis.getVoices() // some browsers load their voices only once asked
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
