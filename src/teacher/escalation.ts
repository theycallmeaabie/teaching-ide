/**
 * Did the last hint land?
 *
 * The observer can open the gate again after the teacher has spoken. If the
 * code is byte-for-byte what it was when the hint was given, the hint did not
 * help — and saying the same thing again, however it is phrased, is the one
 * move that is certainly wrong. So the next hint climbs a rung.
 *
 * Pure, so the rule is testable without a browser.
 */

export type LastHint = { hash: number; tier: number }

/** djb2. Collisions are harmless here: the worst case is one missed escalation. */
export function hashBuffer(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h
}

export function lastHintFailed(last: LastHint | undefined, buffer: string): boolean {
  return last != null && last.hash === hashBuffer(buffer)
}

/**
 * The tier the next hint should be given at. Never lower than where the ladder
 * already is — a failed run may have climbed it since — and never past 5.
 * Climbing happens once per failure, not once per failure per mechanism.
 */
export function escalatedTier(currentTier: number, last: LastHint): number {
  return Math.min(5, Math.max(currentTier, last.tier + 1))
}
