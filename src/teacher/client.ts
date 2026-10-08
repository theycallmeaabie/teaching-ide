import type { Misconception, RunResult } from '../types'
import type { LearnerProfile } from '../lesson/profile'
import { accessToken } from '../auth/supabase'

export type TeacherTool =
  | 'give_hint'
  | 'explain'
  | 'ask_question'
  | 'translate_error'
  | 'confirm_success'
  | 'stay_silent'

export type TeacherDecision = {
  tool: TeacherTool
  args: Record<string, unknown>
  source: 'llm' | 'prewritten' | 'lookup'
  note: string | null
  cached?: boolean
  doc_version: number
}

export type TeachRequestBody = {
  doc_version: number
  buffer: string
  exercise_id: string
  exercise_prompt: string
  expected_stdout: string
  exercise_concept: string
  exercise_section: string
  tier: number
  tier_texts: string[]
  attempts: number
  last_run: {
    ok: boolean
    stdout: string
    error?: { type: string; message: string; line: number | null }
    correct: boolean
  } | null
  misconceptions: string[]
  misconception_notes: string[]
  asked_for_answer: number
  idle_ms: number
  last_edit_ms_ago: number | null
  stuck_score: number
  trigger: 'gate' | 'ask' | 'success'
  learner_question: string | null
  recent: { role: 'teacher' | 'learner'; text: string }[]
  /** Who they have been so far. Null for a newcomer. */
  profile: LearnerProfile | null
  /** The last hint was given and the code has not changed since. */
  previous_hint_failed: boolean
  /** One per page load, so the server can count interruptions per sitting. */
  session_id: string
}

type Handlers = {
  onTool?: (tool: TeacherTool) => void
  onDelta?: (text: string) => void
  onFallback?: (note: string) => void
}

/**
 * Streams one teaching decision. Returns null only if the network itself failed
 * — every other failure mode is turned into a usable decision by the backend,
 * because the lesson must not stall on a bad model response.
 */
export async function askTeacher(
  body: TeachRequestBody,
  handlers: Handlers = {},
  signal?: AbortSignal,
): Promise<TeacherDecision | null> {
  // Sent when signed in; the server treats its absence as an anonymous call
  // rather than a refusal, so the lesson works either way.
  const token = await accessToken()

  let res: Response
  try {
    res = await fetch('/api/teach', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    return null
  }
  if (!res.ok || !res.body) return null

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let decision: TeacherDecision | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line.
    let split: number
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)

      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (!data) continue

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      if (event === 'tool') handlers.onTool?.(parsed.tool as TeacherTool)
      else if (event === 'delta') handlers.onDelta?.(parsed.text as string)
      else if (event === 'fallback') handlers.onFallback?.(parsed.note as string)
      else if (event === 'done') decision = parsed as unknown as TeacherDecision
    }
  }

  return decision
}

/** Pure lookup on the backend. No model, no tokens, no interruption budget. */
export async function translateError(error: {
  type: string
  message: string
  line: number | null
}): Promise<{ plain_english: string; line: number | null } | null> {
  try {
    const res = await fetch('/api/translate-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(error),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.known ? data : null
  } catch {
    return null
  }
}

export function runResultForWire(
  result: RunResult | null,
  correct: boolean,
): TeachRequestBody['last_run'] {
  if (!result) return null
  return {
    ok: result.ok,
    stdout: result.stdout.slice(0, 400),
    error: result.error
      ? { type: result.error.type, message: result.error.message, line: result.error.line }
      : undefined,
    correct,
  }
}

export const misconceptionIds = (m: Misconception[]) => m.map((x) => x.id)
