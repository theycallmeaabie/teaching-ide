import type { RunResult } from '../types'

/** What an edit batch did to the program's structure. */
export type SemanticVerdict =
  | 'changed' // the AST differs — real progress, however wrong
  | 'cosmetic' // ast.dump() identical: whitespace, comments, retyping
  | 'rename' // only identifiers differ
  | 'unparseable' // does not parse; weak evidence on its own
  | 'pending' // snapshot not back yet

/**
 * The typed event stream. Appended to a module-level array — never to the
 * store, so nothing re-renders when the log grows.
 */
export type Event =
  | {
      t: number
      type: 'edit'
      linesChanged: number[]
      charDelta: number
      /** Filled in asynchronously once the worker returns an AST snapshot. */
      semantic?: SemanticVerdict
    }
  | {
      t: number
      type: 'run'
      result: RunResult
      /** Did it actually solve the exercise? A clean run with the wrong answer
       *  is the accumulator-inside-the-loop case, and it is not progress. */
      correct: boolean
    }
  | { t: number; type: 'idle'; durationMs: number }
  | { t: number; type: 'ask'; text: string }
  /**
   * Not a learner action — the gate's own decision, recorded so a tuning
   * session can be read back as a timeline.
   */
  | {
      t: number
      type: 'gate'
      trigger: 'score' | 'hardIdle'
      score: number
      reason: string
    }

export type EventType = Event['type']

/** One named term of the stuck score, as shown in the dev panel. */
export type Contribution = {
  key: string
  label: string
  /** Signed: positive pushes toward stuck, negative toward fine. */
  value: number
  detail: string
}

export type ScoreResult = {
  score: number
  contributions: Contribution[]
}
