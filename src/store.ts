import { create } from 'zustand'
import type { Misconception, RunResult, RunnerStatus } from './types'
import { EXERCISES } from './lesson/exercises'
import type { TeacherHealth } from './teacher/health'
import type { AuthUser } from './auth/supabase'
import { readGuest } from './auth/guest'

export type SpeechKind = 'hint' | 'question' | 'explain' | 'error' | 'success'

/** Everything the teacher is currently saying. One at a time, never modal. */
export type Speech = {
  id: number
  kind: SpeechKind
  tier: number | null
  /** What is visible right now — grows while streaming. */
  text: string
  targetLine: number | null
  scratch?: string
  followup?: string | null
  source: 'llm' | 'prewritten' | 'lookup'
  streaming: boolean
}

/** One turn of the conversation. `kind` and `tier` say what sort of thing the
 *  teacher was doing (a rung-2 hint, an explanation) so the conversation can
 *  show it. Optional: turns saved before they existed simply have neither. */
export type Interaction = {
  role: 'teacher' | 'learner'
  text: string
  kind?: SpeechKind
  tier?: number | null
}

type AppState = {
  runnerStatus: RunnerStatus
  lastResult: RunResult | null
  slowRun: boolean
  /** Plain-English reading of the last error. Dictionary, not model. */
  errorPlain: string | null

  exerciseIndex: number
  /** Bumped when a different person takes over, so the editor swaps its buffer
   *  even though the exercise has not changed — otherwise the last learner's
   *  code would still be on screen. */
  bufferEpoch: number
  attempts: number
  tier: number
  hintsGiven: number
  speech: Speech | null
  misconceptions: Misconception[]
  solved: boolean[]
  /** How many times they have asked to just be told, on THIS exercise. Three
   *  descends a tier. Summed across exercises for the learner profile. */
  askedForAnswer: number
  /** Misconception ids detected on this exercise, once each. */
  seen: string[]
  /** The conversation on this exercise, oldest first. Kept whole — the teacher
   *  is shown the tail of it, and it is saved so it survives a refresh. */
  recent: Interaction[]
  teacherBusy: boolean
  /** Why the teacher chose silence, for the dev panel. */
  lastSilence: string | null
  health: TeacherHealth | null

  /** Null when signed out, or when Supabase is not configured at all. */
  user: AuthUser | null
  /** False until the first auth check settles, so the UI does not flash a
   *  sign-in form at someone who is already signed in. */
  authReady: boolean
  /** They chose "Continue as guest" on the sign-in page: in, but nothing is saved. */
  guest: boolean
  /** Saved progress has been read back. Until then, do not write it out —
   *  an empty store would overwrite real rows with blanks. */
  progressLoaded: boolean
  /** Why progress is not being kept, in words for the learner. Null when it is. */
  progressError: string | null

  setRunnerStatus: (s: RunnerStatus) => void
  setLastResult: (r: RunResult | null) => void
  setSlowRun: (v: boolean) => void
  set: (p: Partial<AppState>) => void
}

export const useStore = create<AppState>((set) => ({
  runnerStatus: 'booting',
  lastResult: null,
  slowRun: false,
  errorPlain: null,

  exerciseIndex: 0,
  bufferEpoch: 0,
  attempts: 0,
  tier: 1,
  hintsGiven: 0,
  speech: null,
  misconceptions: [],
  solved: EXERCISES.map(() => false),
  askedForAnswer: 0,
  seen: [],
  recent: [],
  teacherBusy: false,
  lastSilence: null,
  health: null,

  user: null,
  authReady: false,
  guest: readGuest(),
  progressLoaded: false,
  progressError: null,

  setRunnerStatus: (runnerStatus) => set({ runnerStatus }),
  setLastResult: (lastResult) => set({ lastResult }),
  setSlowRun: (slowRun) => set({ slowRun }),
  set: (p) => set(p),
}))
