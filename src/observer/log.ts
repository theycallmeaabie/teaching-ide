import type { Event } from './types'

/**
 * The event log. A plain module-level array on purpose: this grows on every
 * keystroke batch and must never cause a React render. The dev panel reads it
 * on a timer instead.
 */
const events: Event[] = []

/** Session start, so exported timestamps are readable relative offsets. */
export const sessionStartedAt = Date.now()

export function append(event: Event): Event {
  events.push(event)
  return event
}

export function all(): readonly Event[] {
  return events
}

export function count(): number {
  return events.length
}

/** Most recent `n`, oldest first. */
export function recent(n: number): Event[] {
  return events.slice(Math.max(0, events.length - n))
}

/** Everything at or after `t`. Walks backwards — the window is always short. */
export function since(t: number): Event[] {
  let i = events.length
  while (i > 0 && events[i - 1].t >= t) i--
  return events.slice(i)
}

export function lastOfType<T extends Event['type']>(
  type: T,
): Extract<Event, { type: T }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i] as Extract<Event, { type: T }>
  }
  return null
}

export function clear() {
  events.length = 0
}

export type ExportedLog = {
  exportedAt: string
  sessionStartedAt: string
  durationMs: number
  config: Record<string, number>
  events: (Event & { offsetMs: number })[]
}

/** The evidence. */
export function exportJson(config: Record<string, number>): ExportedLog {
  const now = Date.now()
  return {
    exportedAt: new Date(now).toISOString(),
    sessionStartedAt: new Date(sessionStartedAt).toISOString(),
    durationMs: now - sessionStartedAt,
    config,
    events: events.map((e) => ({ ...e, offsetMs: e.t - sessionStartedAt })),
  }
}
