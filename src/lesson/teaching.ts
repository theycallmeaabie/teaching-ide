import { runner } from '../exec/runner'
import * as observer from '../observer/observer'
import { useStore } from '../store'
import { explainError, isAskingForAnswer, requestTeaching } from '../teacher/bridge'
import type { RunResult } from '../types'
import { EXERCISES, isCorrect } from './exercises'

/** Three "just tell me"s descend a rung. Not a refusal, but not free either. */
const BEGS_PER_TIER = 3

export function currentExercise() {
  return EXERCISES[useStore.getState().exerciseIndex]
}

/** Called after every run. Owns tier progression and success detection. */
export async function submitRun(result: RunResult, source: string) {
  const s = useStore.getState()
  const exercise = EXERCISES[s.exerciseIndex]

  // Told to the observer synchronously: "ran without raising" is not the same
  // as "solved it", and the difference is the whole accumulator lesson.
  const correct = result.ok && isCorrect(result.stdout, exercise)
  observer.recordRun(result, correct)

  // Not gated, not billed, not the teacher: just making the error legible.
  if (result.error) void explainError(result.error)
  else s.set({ errorPlain: null })

  const misconceptions = (await runner.diagnose(source)) ?? []

  if (correct) {
    const solved = [...s.solved]
    solved[s.exerciseIndex] = true
    useStore.getState().set({ solved, misconceptions, speech: null })
    observer.setTeachingState(s.tier, s.attempts)
    // Do not let a success pass unexamined.
    void requestTeaching('success')
    return
  }

  const attempts = s.attempts + 1
  const tier = s.hintsGiven > 0 ? Math.min(5, s.tier + 1) : s.tier
  useStore.getState().set({ attempts, tier, misconceptions })
  observer.setTeachingState(tier, attempts)
}

/** A learner-initiated question. Resets the cooldown, costs no budget. */
export async function askTeacherQuestion(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  const s = useStore.getState()

  observer.recordAsk(trimmed)

  let askedForAnswer = s.askedForAnswer
  let tier = s.tier
  if (isAskingForAnswer(trimmed)) {
    askedForAnswer += 1
    // Never a flat refusal — that reads as obstinate. But asking repeatedly
    // does move them down the ladder.
    if (askedForAnswer % BEGS_PER_TIER === 0) tier = Math.min(5, tier + 1)
  }

  useStore.getState().set({
    askedForAnswer,
    tier,
    recent: [...s.recent, { role: 'learner' as const, text: trimmed }].slice(-6),
  })
  observer.setTeachingState(tier, s.attempts)

  await requestTeaching('ask', trimmed)
}

export function goToExercise(index: number) {
  if (index < 0 || index >= EXERCISES.length) return
  useStore.getState().set({
    exerciseIndex: index,
    attempts: 0,
    tier: 1,
    hintsGiven: 0,
    speech: null,
    misconceptions: [],
    lastResult: null,
    errorPlain: null,
    recent: [],
  })
  observer.setStarter(EXERCISES[index].starter)
  observer.setTeachingState(1, 0)
}
