/** Structured result of executing learner code. Never raw text. */
export type RunResult = {
  ok: boolean
  stdout: string
  error?: {
    type: string // "IndexError"
    message: string // raw message
    line: number | null // line number in learner's code
  }
  durationMs: number
}

export type RunnerStatus = 'booting' | 'idle' | 'running' | 'restarting' | 'failed'

/** Structural snapshot of the buffer, from `ast.dump()` inside the worker. */
export type AstSnapshot = {
  parses: boolean
  /** `ast.dump()` — unchanged means the edit was cosmetic. */
  dump: string | null
  /** Same dump with learner identifiers canonicalised — unchanged means a rename. */
  shape: string | null
  type?: string
  message?: string
  line?: number | null
}

/** A known beginner failure mode spotted in the buffer's AST. */
export type MisconceptionId =
  | 'no-loop'
  | 'index-value-confusion'
  | 'range-off-by-one'
  | 'accumulator-init-inside-loop'
  | 'accumulator-reassigned'
  | 'accumulator-printed-inside-loop'
  | 'loop-body-outside'
  // JavaScript only
  | 'for-in-over-array'
  | 'assign-in-condition'
  | 'missing-return'

export type Misconception = { id: MisconceptionId; line: number | null }
