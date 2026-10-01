import * as observer from '../observer/observer'
import { EXERCISES } from '../lesson/exercises'
import { useStore, type Interaction, type Speech, type SpeechKind } from '../store'
import { askTeacher, runResultForWire, translateError, type TeacherDecision } from './client'
import { fetchHealth } from './health'

let speechId = 0
let inFlight: AbortController | null = null

/** Phrases that mean "stop teaching me and just tell me". */
const BEGGING =
  /\b(just (tell|give|show)|tell me the answer|give me the (answer|code|solution)|what('s| is) the answer|show me the (code|answer|solution)|do it for me|write it for me)\b/i

export function isAskingForAnswer(text: string): boolean {
  return BEGGING.test(text)
}

// ------------------------------------------------------------------ revealing

/**
 * Groq returns a tool call's arguments in one or two chunks, so "streaming"
 * arrives almost all at once. The reveal is paced on the client so the prose
 * appears progressively rather than landing as a wall of text. This is a
 * presentation choice, not real token-by-token generation.
 */
const REVEAL_CHARS_PER_TICK = 4
const REVEAL_TICK_MS = 12

let revealTimer: number | null = null
let revealTarget = ''
let revealShown = 0
let revealDone = false

function stopReveal() {
  if (revealTimer != null) window.clearInterval(revealTimer)
  revealTimer = null
}

function pushRevealed(id: number) {
  const s = useStore.getState().speech
  if (!s || s.id !== id) return stopReveal()
  useStore.getState().set({
    speech: { ...s, text: revealTarget.slice(0, revealShown), streaming: !(revealDone && revealShown >= revealTarget.length) },
  })
}

function startReveal(id: number) {
  stopReveal()
  revealShown = 0
  revealTimer = window.setInterval(() => {
    if (revealShown >= revealTarget.length) {
      if (revealDone) {
        pushRevealed(id)
        stopReveal()
      }
      return
    }
    revealShown = Math.min(revealTarget.length, revealShown + REVEAL_CHARS_PER_TICK)
    pushRevealed(id)
  }, REVEAL_TICK_MS)
}

// ------------------------------------------------------------------ staleness

/**
 * The answer comes back 1-4s later and the learner has kept typing. A tutor
 * confidently explaining a bug they already fixed costs more trust than five
 * missed interventions, so anything that arrives against a changed program is
 * thrown away rather than shown late.
 */
export function materiallyChanged(
  before: string,
  after: string,
  targetLine: number | null,
): boolean {
  if (before === after) return false
  const b = before.split('\n')
  const a = after.split('\n')

  if (targetLine != null) {
    const bl = (b[targetLine - 1] ?? '').trim()
    const al = (a[targetLine - 1] ?? '').trim()
    if (bl !== al) return true // the hint points at something that no longer exists
  }
  if (Math.abs(after.length - before.length) > 12) return true
  if (b.filter((l) => l.trim()).length !== a.filter((l) => l.trim()).length) return true
  return false
}

// -------------------------------------------------------------------- speaking

const KIND: Record<string, SpeechKind> = {
  give_hint: 'hint',
  ask_question: 'question',
  translate_error: 'error',
  confirm_success: 'success',
}

function proseOf(d: TeacherDecision): string {
  const a = d.args
  return String(a.text ?? a.plain_english ?? a.reason ?? '')
}

function targetLineOf(d: TeacherDecision): number | null {
  const v = d.args.target_line
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Ask the teacher, and apply whatever comes back.
 *
 * `trigger` distinguishes the observer opening the gate from the learner asking
 * a direct question — the latter resets the cooldown and costs no budget.
 */
export async function requestTeaching(
  trigger: 'gate' | 'ask' | 'success',
  learnerQuestion: string | null = null,
): Promise<void> {
  const st = useStore.getState()
  const exercise = EXERCISES[st.exerciseIndex]
  if (trigger === 'gate' && st.solved[st.exerciseIndex]) return

  inFlight?.abort()
  inFlight = new AbortController()

  const buffer = observer.doc() || exercise.starter
  const version = observer.version()
  const tier = st.tier
  const solvedBefore = st.solved[st.exerciseIndex]

  st.set({ teacherBusy: true })

  const notes = exercise.watch
    .filter((w) => st.misconceptions.some((m) => m.id === w.id))
    .map((w) => w.note)

  const id = ++speechId
  let opened = false
  revealTarget = ''
  revealDone = false

  const open = (kind: SpeechKind, tierValue: number | null) => {
    const scratch =
      kind === 'hint' && tierValue != null ? exercise.hints[tierValue - 1]?.scratch : undefined

    // The bubble opens on the streamed tool name so the reveal can start
    // before the call finishes, but the server gets the last word: a leaked
    // answer is rejected and replaced by the pre-written rung, and the tool
    // name changes with it. Re-key rather than return, or a hint ends up
    // labelled "what that error means" with no tier and no worked example.
    if (opened) {
      const prev = useStore.getState().speech
      if (prev && prev.id === id && (prev.kind !== kind || prev.tier !== tierValue)) {
        useStore.getState().set({ speech: { ...prev, kind, tier: tierValue, scratch } })
      }
      return
    }

    opened = true
    const speech: Speech = {
      id,
      kind,
      tier: tierValue,
      text: '',
      targetLine: null,
      scratch,
      source: 'llm',
      streaming: true,
    }
    useStore.getState().set({ speech })
    startReveal(id)
  }

  const decision = await askTeacher(
    {
      doc_version: version,
      buffer,
      exercise_id: exercise.id,
      exercise_prompt: exercise.prompt,
      expected_stdout: exercise.expectedStdout,
      tier,
      tier_texts: exercise.hints.map((h) => h.text),
      attempts: st.attempts,
      last_run: runResultForWire(st.lastResult, solvedBefore),
      misconceptions: st.misconceptions.map((m) => m.id),
      misconception_notes: notes,
      asked_for_answer: st.askedForAnswer,
      idle_ms: Math.round(observer.idleMs()),
      last_edit_ms_ago: observer.lastEditMsAgo() == null ? null : Math.round(observer.lastEditMsAgo()!),
      stuck_score: observer.currentScore(),
      trigger,
      learner_question: learnerQuestion,
      recent: st.recent.slice(-3),
    },
    {
      onTool: (tool) => {
        if (tool === 'stay_silent') return
        open(KIND[tool] ?? 'hint', tool === 'give_hint' ? tier : null)
      },
      onDelta: (text) => {
        revealTarget += text
      },
    },
    inFlight.signal,
  )

  useStore.getState().set({ teacherBusy: false })
  // Refresh after every call: this is when degradation actually shows up.
  void fetchHealth().then((health) => useStore.getState().set({ health }))

  // Network died. Phase 3's ladder is still right here.
  if (!decision) {
    stopReveal()
    fallbackToPrewritten(id, trigger, 'backend unreachable')
    return
  }

  if (decision.tool === 'stay_silent') {
    stopReveal()
    useStore.getState().set({
      speech: null,
      lastSilence: String(decision.args.reason ?? ''),
    })
    return
  }

  const prose = proseOf(decision)
  const line = targetLineOf(decision)

  // Did the ground move while we were waiting?
  const now = useStore.getState()
  const changed =
    materiallyChanged(buffer, observer.doc(), line) ||
    (now.solved[now.exerciseIndex] && !solvedBefore && trigger !== 'success')
  if (changed) {
    stopReveal()
    useStore.getState().set({
      speech: null,
      lastSilence: `discarded — the buffer moved on (v${version} → v${observer.version()})`,
    })
    return
  }

  const kind = KIND[decision.tool] ?? 'hint'
  open(kind, decision.tool === 'give_hint' ? tier : null)
  revealTarget = prose
  revealDone = true

  const s = useStore.getState().speech
  if (s && s.id === id) {
    useStore.getState().set({
      speech: {
        ...s,
        targetLine: line,
        source: decision.source,
        followup: (decision.args.followup_question as string | undefined) ?? null,
      },
      // Why the backend had to fall back is the most useful thing it tells us.
      lastSilence: decision.note ?? (decision.cached ? 'replayed from cache' : null),
    })
  }

  const interaction: Interaction = { role: 'teacher', text: prose }
  useStore.getState().set({
    recent: [...useStore.getState().recent, interaction].slice(-6),
    hintsGiven: useStore.getState().hintsGiven + (kind === 'hint' ? 1 : 0),
  })
  observer.noteTeacherSpoke(trigger === 'gate')
  observer.setTeachingState(tier, useStore.getState().attempts)
}

/**
 * Deliver the current rung in its pre-written words. This is the Phase 3
 * behaviour, and it is also what every failure path in Phase 4 lands on: a
 * dead backend, a malformed tool call, a hint that gave away the answer.
 */
export function deliverPrewrittenHint(note = 'requested directly') {
  fallbackToPrewritten(++speechId, 'gate', note)
}

function fallbackToPrewritten(id: number, trigger: string, note: string) {
  const st = useStore.getState()
  const exercise = EXERCISES[st.exerciseIndex]
  if (trigger === 'success') {
    st.set({
      speech: { id, kind: 'success', tier: null, text: 'That is it exactly.', targetLine: null, followup: 'Why did that work?', source: 'prewritten', streaming: false },
      lastSilence: note,
    })
    return
  }
  const h = exercise.hints[st.tier - 1]
  if (!h) return
  st.set({
    speech: {
      id,
      kind: 'hint',
      tier: h.tier,
      text: h.text,
      targetLine: st.misconceptions.find((m) => m.line != null)?.line ?? h.targetLine,
      scratch: h.scratch,
      source: 'prewritten',
      streaming: false,
    },
    hintsGiven: st.hintsGiven + 1,
    lastSilence: note,
  })
  observer.noteTeacherSpoke(trigger === 'gate')
}

/** Error translation is a dictionary lookup: instant, free, and not gated. */
export async function explainError(error: { type: string; message: string; line: number | null }) {
  const t = await translateError(error)
  useStore.getState().set({ errorPlain: t?.plain_english ?? null })
}

export function dismissSpeech() {
  stopReveal()
  useStore.getState().set({ speech: null })
}
