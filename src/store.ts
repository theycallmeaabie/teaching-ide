import { create } from 'zustand'
import type { Misconception, RunResult, RunnerStatus } from './types'
import { EXERCISES } from './lesson/exercises'
import type { TeacherHealth } from './teacher/health'

export type SpeechKind = 'hint' | 'question' | 'error' | 'success'

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

export type Interaction = { role: 'teacher' | 'learner'; text: string }

type AppState = {
  runnerStatus: RunnerStatus
  lastResult: RunResult | null
  slowRun: boolean
  /** Plain-English reading of the last error. Dictionary, not model. */
  errorPlain: string | null

  exerciseIndex: number
  attempts: number
  tier: number
  hintsGiven: number
  speech: Speech | null
  misconceptions: Misconception[]
  solved: boolean[]
  /** How many times they have asked to just be told. Three descends a tier. */
  askedForAnswer: number
  /** Last three only — never the full transcript. */
  recent: Interaction[]
  teacherBusy: boolean
  /** Why the teacher chose silence, for the dev panel. */
  lastSilence: string | null
  health: TeacherHealth | null

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
  attempts: 0,
  tier: 1,
  hintsGiven: 0,
  speech: null,
  misconceptions: [],
  solved: EXERCISES.map(() => false),
  askedForAnswer: 0,
  recent: [],
  teacherBusy: false,
  lastSilence: null,
  health: null,

  setRunnerStatus: (runnerStatus) => set({ runnerStatus }),
  setLastResult: (lastResult) => set({ lastResult }),
  setSlowRun: (slowRun) => set({ slowRun }),
  set: (p) => set(p),
}))
