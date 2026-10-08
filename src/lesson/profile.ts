import { EXERCISES, SECTIONS, type Section } from './exercises'

/**
 * Who this learner has been so far, across every exercise.
 *
 * Pure: it takes per-exercise stats and returns the few lines the teacher is
 * given. It is what lets a hint be pitched at this person — the exercise they
 * struggled on, the mistake they keep making, the parts that came easily —
 * rather than at an average one.
 *
 * Deliberately small. These lines are paid for in tokens on every call, and a
 * profile that tries to say everything says nothing the model can use.
 */

export type ExerciseStat = {
  exercise_id: string
  solved: boolean
  /** The deepest rung they needed on this exercise. */
  tier: number
  attempts: number
  /** Times they asked to simply be told the answer here. */
  begs: number
  /** Misconception ids detected in this exercise. A set, not a count. */
  seen: string[]
}

export type LearnerProfile = {
  solved: number
  total: number
  struggled: string[]
  recurring: string[]
  comfortable: string[]
  begs: number
}

/** How a misconception reads to the model, in the words a teacher would use. */
export const MISCONCEPTION_LABELS: Record<string, string> = {
  'no-loop': 'writes the steps out by hand instead of using a loop',
  'index-value-confusion': 'treats the loop variable as a position rather than the value',
  'range-off-by-one': 'gets the start or end of a range wrong by one',
  'accumulator-init-inside-loop': 'sets the running total up inside the loop, so it resets every pass',
  'accumulator-reassigned': 'replaces the running total instead of adding to it',
  'accumulator-printed-inside-loop': 'prints inside the loop instead of once at the end',
  'loop-body-outside': 'leaves work outside the loop that belongs inside it',
}

/** Past this, an exercise "took real effort". Rung 3 is where the concept gets
 *  explained, so needing it means the nudge and the pointer were not enough. */
const STRUGGLE_TIER = 3
const STRUGGLE_ATTEMPTS = 4
const MAX_STRUGGLED = 3
const MAX_RECURRING = 2
const MAX_COMFORTABLE = 3

const byId = new Map(EXERCISES.map((e, i) => [e.id, { e, i }]))

/** An exercise they got through without more than a nudge and one wrong try. */
function easy(s: ExerciseStat): boolean {
  return s.solved && s.tier <= 1 && s.attempts <= 1 && s.begs === 0
}

export function buildProfile(stats: ExerciseStat[]): LearnerProfile | null {
  const known = stats.filter((s) => byId.has(s.exercise_id))
  const ramp = (s: ExerciseStat) => byId.get(s.exercise_id)!.i

  const solved = known.filter((s) => s.solved).length

  const struggled = known
    .filter((s) => s.tier >= STRUGGLE_TIER || s.attempts >= STRUGGLE_ATTEMPTS)
    .sort((a, b) => ramp(a) - ramp(b))
    .slice(-MAX_STRUGGLED)
    .map((s) => byId.get(s.exercise_id)!.e.title)

  // A mistake made once is an accident. Made in more than one exercise it is a
  // habit, and a habit is what a teacher should know about.
  const seenIn = new Map<string, number>()
  for (const s of known) for (const id of new Set(s.seen)) seenIn.set(id, (seenIn.get(id) ?? 0) + 1)
  const recurring = [...seenIn.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RECURRING)
    .map(([id]) => MISCONCEPTION_LABELS[id] ?? id)

  // A section is "comfortable" when everything they touched in it was easy and
  // they finished at least one thing. One easy exercise is not a pattern, so
  // it needs to be the whole section's story, not a single data point.
  const comfortable: Section[] = []
  for (const section of SECTIONS) {
    const touched = known.filter(
      (s) => byId.get(s.exercise_id)!.e.section === section && (s.solved || s.attempts > 0 || s.tier > 1),
    )
    if (touched.length && touched.some((s) => s.solved) && touched.every(easy)) comfortable.push(section)
  }

  const begs = known.reduce((n, s) => n + s.begs, 0)

  if (!solved && !struggled.length && !recurring.length && !begs) return null

  return {
    solved,
    total: EXERCISES.length,
    struggled,
    recurring,
    comfortable: comfortable.slice(0, MAX_COMFORTABLE),
    begs,
  }
}
