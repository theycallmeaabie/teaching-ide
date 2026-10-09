import { apiUrl } from '../api'

/**
 * Whether the teacher is actually speaking in its own words right now.
 *
 * With the daily token cap spent, every hint silently becomes the pre-written
 * one. That is the correct behaviour, but a tester who cannot see it happening
 * will end up evaluating the wrong system.
 */
export type TeacherHealth = {
  reachable: boolean
  model: string
  degraded: boolean
  reason: string | null
  retryAfterS: number | null
}

const UNKNOWN: TeacherHealth = {
  reachable: false,
  model: '',
  degraded: true,
  reason: 'backend not reachable',
  retryAfterS: null,
}

export async function fetchHealth(): Promise<TeacherHealth> {
  try {
    const res = await fetch(apiUrl('/api/health'))
    if (!res.ok) return UNKNOWN
    const d = await res.json()
    const llm = d.llm ?? {}
    return {
      reachable: true,
      model: d.model ?? '',
      degraded: llm.ok === false,
      reason: llm.reason ?? null,
      retryAfterS: llm.retry_after_s ?? null,
    }
  } catch {
    return UNKNOWN
  }
}
