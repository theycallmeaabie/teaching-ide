import { runner } from '../exec/runner'
import * as observer from '../observer/observer'
import { useStore } from '../store'
import { explainError, isAskingForAnswer, requestTeaching } from '../teacher/bridge'
import type { RunResult } from '../types'
import { saveProgress, savedFor } from '../data/progress'
import { EXERCISES, isCorrect } from './exercises'

/** Three "just tell me"s descend a rung. Not a refusal, but not free either. */
const BEGS_PER_TIER = 3

export function currentExercise() {
  return EXERCISES[useStore.getState().exerciseIndex]
}

/** Called after every run. Owns tier progression and success detection. */
export async function submitRun(result: RunResult, source: string) {
  const index = useStore.getState().exerciseIndex
  const exercise = EXERCISES[index]

  // Told to the observer synchronously: "ran without raising" is not the same
  // as "solved it", and the difference is the whole accumulator lesson.
  const correct = result.ok && isCorrect(result.stdout, exercise)
  observer.recordRun(result, correct)

  // Not gated, not billed, not the teacher: just making the error legible.
  if (result.error) void explainError(result.error)
  else useStore.getState().set({ errorPlain: null })

  const detected = (await runner.diagnose(source)) ?? []

  // The learner can move on while diagnose is in flight. Everything below
  // writes exercise-scoped state, so a result for an exercise they have
  // already left has to be dropped rather than applied to the new one.
  const s = useStore.getState()
  if (s.exerciseIndex !== index) return

  // A detector firing outside this exercise's watch list is noise rather than
  // a misconception: `no-loop` is true of every exercise before the loops
  // section, and telling a learner on "Say hello" that they have no loop would
  // be worse than silence.
  const watched = new Set(exercise.watch.map((w) => w.id))
  const misconceptions = detected.filter((m) => watched.has(m.id))

  if (correct) {
    const solved = [...s.solved]
    solved[index] = true
    s.set({ solved, misconceptions, speech: null })
    observer.setTeachingState(s.tier, s.attempts)
    void saveProgress(index)
    // Do not let a success pass unexamined.
    void requestTeaching('success')
    return
  }

  const attempts = s.attempts + 1
  const tier = s.hintsGiven > 0 ? Math.min(5, s.tier + 1) : s.tier
  s.set({ attempts, tier, misconceptions })
  observer.setTeachingState(tier, attempts)
  void saveProgress(index)
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
  void saveProgress(s.exerciseIndex)

  await requestTeaching('ask', trimmed)
}

export function goToExercise(index: number) {
  if (index < 0 || index >= EXERCISES.length) return

  // Bank where they got to on the exercise being left before anything resets.
  void saveProgress(useStore.getState().exerciseIndex)

  // Coming back to an exercise should not hand them tier 1 on a problem they
  // have already had four hints about.
  const saved = savedFor(EXERCISES[index].id)

  useStore.getState().set({
    exerciseIndex: index,
    attempts: saved?.attempts ?? 0,
    tier: saved?.tier ?? 1,
    hintsGiven: saved?.hints_given ?? 0,
    speech: null,
    misconceptions: [],
    lastResult: null,
    errorPlain: null,
    recent: [],
  })
  observer.setStarter(EXERCISES[index].starter)
  observer.setTeachingState(saved?.tier ?? 1, saved?.attempts ?? 0)
}
