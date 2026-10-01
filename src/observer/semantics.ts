import { runner } from '../exec/runner'
import type { SemanticVerdict } from './types'

/** Last parseable structure we saw. Unparseable buffers do not replace it, so
 *  a fix is compared against the last state that actually meant something. */
let baseline: { dump: string; shape: string } | null = null

/** The starter's structure, fixed for the exercise. Unlike `baseline` this does
 *  not move, so it can answer "have they written any program of their own yet?"
 *  rather than "did the last edit change anything". */
let starterDump: string | null = null
let latestDump: string | null = null

/** Bumped when the worker restarts or the exercise changes; in-flight snapshots
 *  tagged with an older generation are dropped rather than applied late. */
let generation = 0

export function resetSemantics() {
  baseline = null
  starterDump = null
  latestDump = null
  generation++
}

/**
 * Has the learner written a program of their own yet?
 *
 * "Nothing on the page" is a different state from "stuck on half-written code",
 * and the difference is worth 0.65 of the stuck score — so it needs to be right
 * at both ends of the ramp. A character count cannot do it: a complete, correct
 * answer to "Add two numbers" is twelve characters, while a blank buffer on the
 * accumulator exercise is zero. Structure can: comments and whitespace leave the
 * dump identical, and any real statement changes it.
 *
 * Null means "cannot tell yet" — no snapshot has come back, or the buffer does
 * not parse. The caller falls back to the character count there, because a
 * half-typed line is unparseable but is still unmistakably having started.
 */
export function hasStarted(): boolean | null {
  if (starterDump == null || latestDump == null) return null
  return latestDump !== starterDump
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ])
}

/** Seeds the baseline from the pre-seeded starter buffer, so the learner's very
 *  first edit is judged against what was already on screen. */
export async function seed(source: string): Promise<void> {
  generation++
  baseline = null
  starterDump = null
  latestDump = null
  const gen = generation
  const snap = await withTimeout(runner.astSnapshot(source), 8000)
  if (gen !== generation || !snap?.parses || !snap.dump || !snap.shape) return
  baseline = { dump: snap.dump, shape: snap.shape }
  starterDump = snap.dump
  latestDump = snap.dump
}

export async function classify(source: string): Promise<SemanticVerdict> {
  const gen = generation
  const snap = await withTimeout(runner.astSnapshot(source), 4000)
  if (snap == null || gen !== generation) return 'pending'

  if (!snap.parses || !snap.dump || !snap.shape) return 'unparseable'

  latestDump = snap.dump

  if (baseline == null) {
    baseline = { dump: snap.dump, shape: snap.shape }
    return 'changed'
  }

  const verdict: SemanticVerdict =
    snap.dump === baseline.dump
      ? 'cosmetic'
      : snap.shape === baseline.shape
        ? 'rename'
        : 'changed'

  baseline = { dump: snap.dump, shape: snap.shape }
  return verdict
}
