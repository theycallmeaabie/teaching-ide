import type { ObserverConfig } from './config'

export type GateState = {
  lastInterventionAt: number | null
  /** Interventions spent. Learner-initiated questions never land here. */
  used: number
}

export type GateVerdict = {
  allowed: boolean
  trigger: 'score' | 'hardIdle' | null
  /** Why it stayed shut — the useful half during tuning. */
  blockedBy: string[]
  cooldownRemainingMs: number
  budgetRemaining: number
  reason: string
}

/**
 * The teacher may speak only when score, cooldown and budget all allow it.
 * The hard idle ceiling is the one bypass: after `hardIdleMs` of silence the
 * teacher speaks regardless of score, because a score that low after that long
 * means the observer missed something, not that the learner is fine.
 */
export function evaluateGate(
  now: number,
  score: number,
  idleMs: number,
  state: GateState,
  c: ObserverConfig,
): GateVerdict {
  const budgetRemaining = Math.max(0, c.budget - state.used)
  const sinceLast = state.lastInterventionAt == null ? Infinity : now - state.lastInterventionAt
  const cooldownRemainingMs = Math.max(0, c.cooldownMs - sinceLast)

  const hardIdle = idleMs >= c.hardIdleMs
  const scoreOk = score > c.threshold

  const blockedBy: string[] = []
  if (!scoreOk && !hardIdle) blockedBy.push(`score ${score.toFixed(2)} ≤ ${c.threshold.toFixed(2)}`)
  if (cooldownRemainingMs > 0) blockedBy.push(`cooldown ${(cooldownRemainingMs / 1000).toFixed(0)}s`)
  if (budgetRemaining <= 0) blockedBy.push('budget spent')

  const allowed = blockedBy.length === 0
  const trigger = !allowed ? null : hardIdle && !scoreOk ? 'hardIdle' : 'score'

  return {
    allowed,
    trigger,
    blockedBy,
    cooldownRemainingMs,
    budgetRemaining,
    reason: allowed
      ? trigger === 'hardIdle'
        ? `hard idle ceiling — ${(idleMs / 1000).toFixed(0)}s of silence`
        : `stuck score ${score.toFixed(2)} over ${c.threshold.toFixed(2)}`
      : blockedBy.join(', '),
  }
}
