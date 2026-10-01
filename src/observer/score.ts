import type { ObserverConfig } from './config'
import type { Contribution, Event, ScoreResult } from './types'

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** 0 below `start`, 1 at or above `full`, linear between. */
const ramp = (x: number, start: number, full: number) =>
  full <= start ? (x >= full ? 1 : 0) : clamp01((x - start) / (full - start))

/** 1 when fresh, 0 once `span` has elapsed. */
const ageDecay = (age: number, span: number) => clamp01(1 - age / span)

const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`

export type ScoreInput = {
  now: number
  config: ObserverConfig
  events: readonly Event[]
  /** Last keystroke or run — what "idle" is measured from. */
  lastActivityAt: number
  /** Last keystroke only. */
  lastEditAt: number | null
  /** Characters the learner added beyond the pre-seeded starter buffer. */
  learnerChars: number
  /** Consecutive edit batches that changed nothing structural (renames count partially). */
  cosmeticStreak: number
  /** When the buffer last returned to a state it had already been in. */
  revertedAt: number | null
  /** Whether any program of their own exists yet, judged structurally.
   *  Null when no snapshot has settled, or the buffer does not parse. */
  started: boolean | null
}

/**
 * The stuck score, recomputed from scratch each tick rather than carried as a
 * decaying accumulator. Positive signals age out of the window on their own and
 * progress signals subtract, which is what "decays toward zero on meaningful
 * progress" means here — and every term stays individually inspectable, which a
 * single accumulated number would not be.
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const { now, config: c, events } = input
  const idleMs = now - input.lastActivityAt
  const windowStart = now - c.windowMs
  const contributions: Contribution[] = []

  const add = (key: string, label: string, value: number, detail: string) => {
    if (Math.abs(value) < 0.001) return
    contributions.push({ key, label, value, detail })
  }

  // ---------------------------------------------------------------- positive

  // 1. Idle after error. Deliberately not windowed: sitting on a failed run for
  //    four minutes is more stuck than sitting on it for one, not less.
  const lastRun = lastWhere(events, (e): e is Extract<Event, { type: 'run' }> => e.type === 'run')
  const noEditSinceRun =
    lastRun != null && (input.lastEditAt == null || input.lastEditAt < lastRun.t)
  if (lastRun && !lastRun.correct && noEditSinceRun) {
    const errored = !lastRun.result.ok
    const idleSince = now - lastRun.t
    const weight = errored ? c.wIdleAfterError : c.wIdleAfterWrong
    const v = weight * ramp(idleSince, c.idleAfterErrorStartMs, c.idleAfterErrorFullMs)
    add(
      errored ? 'idleAfterError' : 'idleAfterWrong',
      errored ? 'Idle after error' : 'Idle after wrong answer',
      v,
      errored
        ? `${lastRun.result.error?.type ?? 'error'} ${secs(idleSince)} ago, untouched since`
        : `ran clean but wrong ${secs(idleSince)} ago, untouched since`,
    )
  }

  // 2a. Thrash — the same line visited across many separate edit batches.
  const thrashStart = now - c.thrashWindowMs
  const visits = new Map<number, number>()
  for (const e of events) {
    if (e.t < thrashStart || e.type !== 'edit') continue
    for (const line of e.linesChanged) visits.set(line, (visits.get(line) ?? 0) + 1)
  }
  let hotLine = 0
  let hotCount = 0
  for (const [line, n] of visits) if (n > hotCount) [hotLine, hotCount] = [line, n]
  if (hotCount >= c.thrashLineVisits) {
    const v = c.wThrashLines * clamp01((hotCount - c.thrashLineVisits + 1) / 2)
    add('thrashLines', 'Thrash — same line', v, `line ${hotLine} touched ${hotCount}× in ${secs(c.thrashWindowMs)}`)
  }

  // 2b. Thrash — something written and then taken back out.
  if (input.revertedAt != null && input.revertedAt >= thrashStart) {
    const v = c.wUndoRevert * ageDecay(now - input.revertedAt, c.thrashWindowMs)
    add('undoRevert', 'Thrash — made and undone', v, `reverted ${secs(now - input.revertedAt)} ago`)
  }

  // 2c. Thrash — the same error, again.
  const runs = events.filter((e): e is Extract<Event, { type: 'run' }> => e.type === 'run' && e.t >= windowStart)
  let errStreak = 0
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]
    if (r.result.ok || !r.result.error) break
    const top = runs[runs.length - 1].result.error!
    if (r.result.error.type !== top.type || r.result.error.line !== top.line) break
    errStreak++
  }
  if (errStreak >= 2) {
    const v = c.wRepeatedError * clamp01((errStreak - 1) / 2)
    const top = runs[runs.length - 1].result.error!
    add('repeatedError', 'Thrash — same error again', v, `${top.type} on line ${top.line} ×${errStreak}`)
  }

  // 3. Edits are happening but the program is not changing.
  if (input.cosmeticStreak > 0) {
    const v = c.wNoSemantic * clamp01(input.cosmeticStreak / c.noSemanticBatches)
    add('noSemantic', 'No semantic change', v, `${input.cosmeticStreak.toFixed(1)} non-progress batches`)
  }

  // 4. Silence over an empty buffer — "don't know where to start", which is a
  //    different state from silence over half-written code (that is thinking).
  //
  //    Structure decides this, not length. Across the short end of the ramp a
  //    finished, correct answer is routinely under the character cap —
  //    `print(a + b)` is twelve — so a count alone would read nine of the
  //    twelve short exercises' solutions as an empty buffer and start pushing
  //    toward 0.65 while the learner sits on a working program. The count is
  //    kept only as the fallback for a buffer that will not parse, where no
  //    structural answer exists but a long line is still plainly a start.
  const emptyBuffer =
    input.started == null ? input.learnerChars <= c.emptyBufferMaxChars : !input.started
  if (emptyBuffer) {
    const v = c.wEmptySilence * ramp(idleMs, c.emptySilenceStartMs, c.emptySilenceFullMs)
    const why = input.started == null ? `${input.learnerChars} chars written` : 'nothing written yet'
    add('emptySilence', 'Empty-buffer silence', v, `${why}, idle ${secs(idleMs)}`)
  }

  // ---------------------------------------------------------------- negative

  const lastOk = lastWhere(
    events,
    (e): e is Extract<Event, { type: 'run' }> => e.type === 'run' && e.correct && e.t >= windowStart,
  )
  if (lastOk) {
    add('successfulRun', 'Solved it', -c.dSuccessfulRun * ageDecay(now - lastOk.t, c.windowMs), `${secs(now - lastOk.t)} ago`)
  }

  const lastProgress = lastWhere(
    events,
    (e): e is Extract<Event, { type: 'edit' }> => e.type === 'edit' && e.semantic === 'changed' && e.t >= windowStart,
  )
  if (lastProgress) {
    add('semanticProgress', 'Program changed', -c.dSemanticProgress * ageDecay(now - lastProgress.t, c.windowMs), `${secs(now - lastProgress.t)} ago`)
  }

  const typingStart = now - c.forwardTypingWindowMs
  let netChars = 0
  for (const e of events) if (e.t >= typingStart && e.type === 'edit') netChars += e.charDelta
  if (netChars >= c.forwardTypingChars) {
    add('forwardTyping', 'Typing forward', -c.dForwardTyping, `+${netChars} chars in ${secs(c.forwardTypingWindowMs)}`)
  }

  const score = clamp01(contributions.reduce((sum, c2) => sum + c2.value, 0))
  contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  return { score, contributions }
}

function lastWhere<T extends Event>(
  events: readonly Event[],
  pred: (e: Event) => e is T,
): T | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (pred(e)) return e
  }
  return null
}
