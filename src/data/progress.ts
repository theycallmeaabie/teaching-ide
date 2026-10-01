import { supabase } from '../auth/supabase'
import { EXERCISES, indexOfExercise } from '../lesson/exercises'
import { useStore } from '../store'

/**
 * Per-exercise progress, keyed by the exercise's string id.
 *
 * Every function here is a no-op when Supabase is unconfigured or nobody is
 * signed in. Progress then lives only in the store, exactly as it did before
 * auth existed — losing it on refresh is the old behaviour, not a new bug.
 */

export type ProgressRow = {
  exercise_id: string
  solved: boolean
  tier: number
  attempts: number
  hints_given: number
}

/** Mirrors the rows we have read or written, so moving between exercises does
 *  not need a round trip to decide which rung the learner was on. */
const rows = new Map<string, ProgressRow>()

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** What was saved for one exercise, or null if it has never been attempted. */
export function savedFor(exerciseId: string): ProgressRow | null {
  return rows.get(exerciseId) ?? null
}

/** Reads every row for the signed-in learner and folds it into the store.
 *  Rows naming an exercise that no longer exists are ignored, not an error:
 *  the ramp is allowed to change under saved progress. */
export async function loadProgress(): Promise<void> {
  const userId = await currentUserId()
  if (!supabase || !userId) return

  const { data, error } = await supabase
    .from('progress')
    .select('exercise_id, solved, tier, attempts, hints_given')
    .eq('user_id', userId)

  if (error || !data) return

  rows.clear()
  const solved = EXERCISES.map(() => false)
  for (const row of data as ProgressRow[]) {
    rows.set(row.exercise_id, row)
    const i = indexOfExercise(row.exercise_id)
    if (i >= 0) solved[i] = row.solved
  }

  const s = useStore.getState()
  const here = rows.get(EXERCISES[s.exerciseIndex]?.id ?? '')

  s.set({
    solved,
    // Restore the ladder position for the exercise they are actually on, so
    // signing back in does not hand them tier 1 on a problem they have already
    // had four hints about.
    ...(here ? { tier: here.tier, attempts: here.attempts, hintsGiven: here.hints_given } : {}),
    progressLoaded: true,
  })
}

/** Upserts the row for one exercise. Fire-and-forget: a failed write must not
 *  interrupt the lesson, so the error is swallowed deliberately. */
export async function saveProgress(exerciseIndex: number): Promise<void> {
  const exercise = EXERCISES[exerciseIndex]
  if (!exercise) return

  const s = useStore.getState()
  const row: ProgressRow = {
    exercise_id: exercise.id,
    solved: s.solved[exerciseIndex] ?? false,
    tier: s.tier,
    attempts: s.attempts,
    hints_given: s.hintsGiven,
  }
  rows.set(exercise.id, row)

  const userId = await currentUserId()
  // Never write blanks over real rows before the read has come back.
  if (!supabase || !userId || !s.progressLoaded) return

  try {
    await supabase
      .from('progress')
      .upsert({ ...row, user_id: userId }, { onConflict: 'user_id,exercise_id' })
  } catch {
    // Deliberate: persistence is best-effort, the lesson is not.
  }
}

/** Clears the in-memory copy on sign-out so the next learner on this machine
 *  does not inherit the last one's ticks. */
export function clearProgress(): void {
  rows.clear()
  useStore.getState().set({
    solved: EXERCISES.map(() => false),
    progressLoaded: false,
  })
}
