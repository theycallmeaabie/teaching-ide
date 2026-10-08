import { runner } from '../exec/runner'
import * as observer from '../observer/observer'
import { useStore } from '../store'
import { cancelTeaching, explainError, isAskingForAnswer, requestTeaching } from '../teacher/bridge'
import type { RunResult } from '../types'
import { saveProgress, savedFor, THREAD_CAP } from '../data/progress'
import { firstUnsolved, type Course } from './courses'
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
  // Remembered per exercise so the same mistake turning up in a second one can
  // be recognised as a habit, which is what a teacher actually wants to know.
  const seen = [...new Set([...s.seen, ...misconceptions.map((m) => m.id)])]

  if (correct) {
    const solved = [...s.solved]
    solved[index] = true
    s.set({ solved, misconceptions, seen, speech: null })
    observer.setTeachingState(s.tier, s.attempts)
    void saveProgress(index)
    // Do not let a success pass unexamined.
    void requestTeaching('success')
    return
  }

  const attempts = s.attempts + 1
  const tier = s.hintsGiven > 0 ? Math.min(5, s.tier + 1) : s.tier
  s.set({ attempts, tier, misconceptions, seen })
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
    recent: [...s.recent, { role: 'learner' as const, text: trimmed }].slice(-THREAD_CAP),
  })
  observer.setTeachingState(tier, s.attempts)
  void saveProgress(s.exerciseIndex)

  await requestTeaching('ask', trimmed)
}

export function goToExercise(index: number) {
  if (index < 0 || index >= EXERCISES.length) return

  // Bank where they got to on the exercise being left before anything resets,
  // and drop any answer still on its way: it is about code they are leaving.
  void saveProgress(useStore.getState().exerciseIndex)
  cancelTeaching()

  // Coming back to an exercise should not hand them tier 1 and a blank
  // conversation on a problem they have already had four hints about.
  const saved = savedFor(EXERCISES[index].id)

  useStore.getState().set({
    exerciseIndex: index,
    attempts: saved?.attempts ?? 0,
    tier: saved?.tier ?? 1,
    hintsGiven: saved?.hints_given ?? 0,
    askedForAnswer: saved?.begs ?? 0,
    seen: saved?.seen ?? [],
    recent: saved?.thread ?? [],
    speech: null,
    misconceptions: [],
    lastResult: null,
    errorPlain: null,
    lastSilence: null,
  })
  observer.setStarter(EXERCISES[index].starter)
  observer.setTeachingState(saved?.tier ?? 1, saved?.attempts ?? 0)
}

/**
 * "Continue" on the course page. Someone who has just signed in is at the top
 * of the ramp with their solved ticks restored, and opening exercise 1 again
 * would not be continuing, so they are taken to the first one they have not
 * solved. A sitting that has already moved knows where it is and is left alone.
 */
export function resumeCourse(course: Course) {
  const s = useStore.getState()
  if (s.exerciseIndex !== 0 || s.attempts > 0 || s.recent.length > 0) return
  const next = firstUnsolved(course, s.solved)
  if (next != null && next !== 0) goToExercise(next)
}

/**
 * The learner is leaving the editor for another page. Bank where they got to,
 * drop an answer still on its way, and let go of what only made sense beside the
 * code on screen: the editor comes back at the starter, so the speech bubble, the
 * last run's output and the misconceptions read off that code would describe
 * something that is no longer there. The conversation and the ladder are kept,
 * as they are when moving between exercises.
 */
export function leaveLesson() {
  // Only for someone signed in. When the page is leaving BECAUSE they signed out
  // the learner state has already been reset, and banking it would plant a blank
  // row for the next person. A guest's place is held in the store regardless.
  if (useStore.getState().user) void saveProgress(useStore.getState().exerciseIndex)
  cancelTeaching()
  // Code left running in a worker nobody is watching would run on, unseen.
  if (runner.isRunning) runner.stop()
  useStore.getState().set({
    speech: null,
    misconceptions: [],
    lastResult: null,
    errorPlain: null,
    lastSilence: null,
    slowRun: false,
  })
}
