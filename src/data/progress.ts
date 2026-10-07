import { supabase } from '../auth/supabase'
import { EXERCISES, indexOfExercise } from '../lesson/exercises'
import { buildProfile, type ExerciseStat, type LearnerProfile } from '../lesson/profile'
import { useStore, type Interaction } from '../store'

/**
 * Per-exercise progress, keyed by the exercise's string id.
 *
 * Besides where they got to, each row carries what the teacher needs to
 * remember them: the conversation on that exercise, how often they asked to be
 * told the answer, and which mistakes showed up. That is what lets a teacher
 * pick up where it left off, in this sitting or the next.
 *
 * Without Supabase configured, or with nobody signed in, none of it is written
 * anywhere — but it is still kept in memory for the sitting, so the teacher
 * remembers a guest for as long as the tab is open.
 */

export type ProgressRow = {
  exercise_id: string
  solved: boolean
  tier: number
  attempts: number
  hints_given: number
  begs: number
  seen: string[]
  thread: Interaction[]
}

/** Enough to remember a conversation, bounded so a row stays small. */
export const THREAD_CAP = 40

const COLUMNS = 'exercise_id, solved, tier, attempts, hints_given, begs, seen, thread'

/** Mirrors every row read or written, so moving between exercises and building
 *  the learner profile never need a round trip. */
const rows = new Map<string, ProgressRow>()

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** Rows written before a column existed come back with it null. */
function normalise(r: Partial<ProgressRow> & { exercise_id: string }): ProgressRow {
  return {
    exercise_id: r.exercise_id,
    solved: !!r.solved,
    tier: r.tier ?? 1,
    attempts: r.attempts ?? 0,
    hints_given: r.hints_given ?? 0,
    begs: r.begs ?? 0,
    seen: Array.isArray(r.seen) ? r.seen : [],
    thread: Array.isArray(r.thread) ? r.thread : [],
  }
}

/** What was saved for one exercise, or null if it has never been attempted. */
export function savedFor(exerciseId: string): ProgressRow | null {
  return rows.get(exerciseId) ?? null
}

/** Per-exercise stats, with the live exercise overlaid since it is ahead of
 *  whatever was last written. */
export function exerciseStats(): ExerciseStat[] {
  const s = useStore.getState()
  const out = new Map<string, ExerciseStat>()
  for (const r of rows.values()) {
    out.set(r.exercise_id, {
      exercise_id: r.exercise_id,
      solved: r.solved,
      tier: r.tier,
      attempts: r.attempts,
      begs: r.begs,
      seen: r.seen,
    })
  }
  const cur = EXERCISES[s.exerciseIndex]
  if (cur) {
    out.set(cur.id, {
      exercise_id: cur.id,
      solved: s.solved[s.exerciseIndex] ?? false,
      tier: s.tier,
      attempts: s.attempts,
      begs: s.askedForAnswer,
      seen: s.seen,
    })
  }
  return [...out.values()]
}

/** Who this learner has been so far, for the teacher. Null for a newcomer. */
export function learnerProfile(): LearnerProfile | null {
  return buildProfile(exerciseStats())
}

/** Reads every row for the signed-in learner and folds it into the store.
 *  Rows naming an exercise that no longer exists are ignored, not an error:
 *  the ramp is allowed to change under saved progress. */
export async function loadProgress(): Promise<void> {
  const userId = await currentUserId()
  if (!supabase || !userId) return

  const { data, error } = await supabase
    .from('progress')
    .select(COLUMNS)
    .eq('user_id', userId)

  if (error || !data) {
    // Saving stays off until a read has worked: writing before knowing what is
    // there could overwrite real rows with blanks. But say so — otherwise a
    // learner works a whole session believing it is being kept.
    console.warn('progress: could not load', error?.message)
    useStore.getState().set({
      progressLoaded: false,
      progressError: "Couldn't load your saved progress, so nothing is being saved.",
    })
    return
  }

  const s = useStore.getState()

  // A brand-new account: there is nothing to restore, and wiping what this
  // sitting has already done would be a poor welcome. Adopt it.
  if (data.length === 0) {
    s.set({ progressLoaded: true, progressError: null })
    for (let i = 0; i < EXERCISES.length; i++) {
      const active = i === s.exerciseIndex && (s.attempts > 0 || s.recent.length > 0)
      if (s.solved[i] || active) void saveProgress(i)
    }
    return
  }

  rows.clear()
  const solved = EXERCISES.map(() => false)
  for (const raw of data as (Partial<ProgressRow> & { exercise_id: string })[]) {
    const row = normalise(raw)
    rows.set(row.exercise_id, row)
    const i = indexOfExercise(row.exercise_id)
    if (i >= 0) solved[i] = row.solved
  }

  const here = rows.get(EXERCISES[s.exerciseIndex]?.id ?? '')

  s.set({
    solved,
    // Restore everything about the exercise they are actually on, so signing
    // back in does not hand them tier 1 and a blank conversation on a problem
    // they have already had four hints about.
    ...(here
      ? {
          tier: here.tier,
          attempts: here.attempts,
          hintsGiven: here.hints_given,
          askedForAnswer: here.begs,
          seen: here.seen,
          recent: here.thread,
        }
      : {}),
    progressLoaded: true,
    progressError: null,
  })
}

/** Writes the row for one exercise. Fire-and-forget: a failed write must not
 *  interrupt the lesson. It is surfaced, though, because a silent failure is
 *  the worst kind — they would carry on believing it was kept. */
export async function saveProgress(exerciseIndex: number): Promise<void> {
  const exercise = EXERCISES[exerciseIndex]
  if (!exercise) return

  const s = useStore.getState()
  const prev = rows.get(exercise.id)
  const live = exerciseIndex === s.exerciseIndex

  const row: ProgressRow = {
    exercise_id: exercise.id,
    solved: s.solved[exerciseIndex] ?? false,
    // Only the exercise on screen has live state; any other keeps what it had.
    tier: live ? s.tier : prev?.tier ?? 1,
    attempts: live ? s.attempts : prev?.attempts ?? 0,
    hints_given: live ? s.hintsGiven : prev?.hints_given ?? 0,
    begs: live ? s.askedForAnswer : prev?.begs ?? 0,
    seen: live ? s.seen : prev?.seen ?? [],
    thread: (live ? s.recent : prev?.thread ?? []).slice(-THREAD_CAP),
  }
  rows.set(exercise.id, row)

  const userId = await currentUserId()
  // Never write before the read has come back: an empty store would overwrite
  // real rows with blanks.
  if (!supabase || !userId || !useStore.getState().progressLoaded) return

  const { error } = await supabase
    .from('progress')
    .upsert({ ...row, user_id: userId }, { onConflict: 'user_id,exercise_id' })

  if (error) {
    console.warn('progress: could not save', error.message)
    useStore.getState().set({ progressError: "Couldn't save your progress just now." })
  } else if (useStore.getState().progressError) {
    useStore.getState().set({ progressError: null })
  }
}

/** Forgets every row held in memory. The rest of "a different person is here"
 *  — the buffer, the ladder, the conversation — is `resetLearner`'s job. */
export function clearProgress(): void {
  rows.clear()
  useStore.getState().set({ progressLoaded: false, progressError: null })
}
