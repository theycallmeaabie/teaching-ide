import { runner } from '../exec/runner'
import type { SemanticVerdict } from './types'

/** Last parseable structure we saw. Unparseable buffers do not replace it, so
 *  a fix is compared against the last state that actually meant something. */
let baseline: { dump: string; shape: string } | null = null

/** Bumped when the worker restarts or the exercise changes; in-flight snapshots
 *  tagged with an older generation are dropped rather than applied late. */
let generation = 0

export function resetSemantics() {
  baseline = null
  generation++
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
  const gen = generation
  const snap = await withTimeout(runner.astSnapshot(source), 8000)
  if (gen !== generation || !snap?.parses || !snap.dump || !snap.shape) return
  baseline = { dump: snap.dump, shape: snap.shape }
}

export async function classify(source: string): Promise<SemanticVerdict> {
  const gen = generation
  const snap = await withTimeout(runner.astSnapshot(source), 4000)
  if (snap == null || gen !== generation) return 'pending'

  if (!snap.parses || !snap.dump || !snap.shape) return 'unparseable'

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
