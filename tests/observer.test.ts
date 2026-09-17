import { DEFAULT_CONFIG, type ObserverConfig } from '../src/observer/config'
import { computeScore, type ScoreInput } from '../src/observer/score'
import { evaluateGate, type GateState } from '../src/observer/gate'
import type { Event } from '../src/observer/types'
import type { RunResult } from '../src/types'

const T0 = 1_000_000
const s = (n: number) => n * 1000
const cfg = (over: Partial<ObserverConfig> = {}): ObserverConfig => ({ ...DEFAULT_CONFIG, ...over })

const okRun = (): RunResult => ({ ok: true, stdout: '3\n7\n', durationMs: 4 })
const errRun = (type = 'NameError', line: number | null = 3): RunResult => ({
  ok: false, stdout: '', durationMs: 4, error: { type, message: 'boom', line },
})

const edit = (t: number, lines: number[], delta: number, semantic: Event extends { semantic?: infer S } ? S : never = 'changed' as never): Event =>
  ({ t, type: 'edit', linesChanged: lines, charDelta: delta, semantic } as Event)
const run = (t: number, result: RunResult, correct = false): Event => ({ t, type: 'run', result, correct })

function score(over: Partial<ScoreInput> & { now: number; events: Event[] }) {
  const base: ScoreInput = {
    now: over.now,
    config: cfg(),
    events: over.events,
    lastActivityAt: over.lastActivityAt ?? over.events.at(-1)?.t ?? T0,
    lastEditAt: over.lastEditAt ?? null,
    learnerChars: over.learnerChars ?? 200,
    cosmeticStreak: over.cosmeticStreak ?? 0,
    revertedAt: over.revertedAt ?? null,
  }
  return computeScore({ ...base, ...over })
}

let failures = 0
function check(name: string, pass: boolean, detail = '') {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps

console.log('\n--- Signal: idle after error -------------------------------------')
{
  const events = [edit(T0, [3], 12), run(T0 + s(2), errRun())]
  const at = (dt: number) => score({ now: T0 + s(2) + dt, events, lastEditAt: T0, lastActivityAt: T0 + s(2) })
  const a10 = at(s(10)), a45 = at(s(45)), a90 = at(s(90))
  check('quiet at 10s after an error', a10.score < 0.3, a10.score.toFixed(2))
  check('crosses 0.6 by 45s of staring at an error', a45.score > 0.6, a45.score.toFixed(2))
  check('stays high at 90s (signal is not windowed away)', a90.score > 0.6, a90.score.toFixed(2))
  check('idleAfterError is the dominant term', a45.contributions[0].key === 'idleAfterError', a45.contributions[0].key)
}

console.log('\n--- Editing after an error clears the signal ----------------------')
{
  const events = [run(T0, errRun()), edit(T0 + s(40), [3], 8)]
  const r = score({ now: T0 + s(41), events, lastEditAt: T0 + s(40), lastActivityAt: T0 + s(40) })
  check('one keystroke kills idle-after-error', !r.contributions.some((c) => c.key === 'idleAfterError'), r.score.toFixed(2))
  check('score drops below threshold', r.score < 0.6, r.score.toFixed(2))
}

console.log('\n--- Negative signals ---------------------------------------------')
{
  const events = [edit(T0, [3], 20), run(T0 + s(1), okRun(), true)]
  const r = score({ now: T0 + s(5), events, lastEditAt: T0, lastActivityAt: T0 + s(1) })
  check('a successful run pins the score at 0', r.score === 0, r.score.toFixed(2))

  const typing = [edit(T0, [1], 15), edit(T0 + s(3), [2], 18), edit(T0 + s(6), [3], 14)]
  const t = score({ now: T0 + s(8), events: typing, lastEditAt: T0 + s(6), lastActivityAt: T0 + s(6) })
  check('steady forward typing stays at 0', t.score === 0, t.score.toFixed(2))
}

console.log('\n--- A clean run with the wrong answer is not progress -------------')
{
  // The accumulator reset inside the loop: no error, wrong number, every time.
  const events = [edit(T0, [4], 12), run(T0 + s(2), okRun(), false)]
  const at = (dt: number) => score({ now: T0 + s(2) + dt, events, lastEditAt: T0, lastActivityAt: T0 + s(2) })
  const r = at(s(45))
  check('sitting on a wrong-but-clean answer scores stuck', r.score > 0.6, r.score.toFixed(2))
  check('reported as a wrong answer, not an error',
    r.contributions.some((c) => c.key === 'idleAfterWrong'), r.contributions.map(c => c.key).join(','))
  check('a clean-but-wrong run gives no progress credit',
    !r.contributions.some((c) => c.key === 'successfulRun'))

  const solved = score({ now: T0 + s(47), events: [edit(T0, [4], 12), run(T0 + s(2), okRun(), true)], lastEditAt: T0, lastActivityAt: T0 + s(2) })
  check('the same run, once correct, drops the score to 0', solved.score === 0, solved.score.toFixed(2))
}

console.log('\n--- Silence over half-written code is thinking, not stuck ---------')
{
  const events = [edit(T0, [3], 40)]
  const r = score({ now: T0 + s(100), events, lastEditAt: T0, lastActivityAt: T0, learnerChars: 120 })
  check('100s idle over real code does not trigger', r.score < 0.6, r.score.toFixed(2))
  check('...and reports no empty-buffer signal', !r.contributions.some((c) => c.key === 'emptySilence'))
}

console.log('\n--- Empty-buffer silence -----------------------------------------')
{
  const events: Event[] = []
  const at = (dt: number) => score({ now: T0 + dt, events, lastActivityAt: T0, learnerChars: 0 })
  check('20s of nothing is not yet stuck', at(s(20)).score < 0.3, at(s(20)).score.toFixed(2))
  check('~75s of an empty buffer crosses', at(s(75)).score > 0.6, at(s(75)).score.toFixed(2))
}

console.log('\n--- Thrash --------------------------------------------------------')
{
  const events: Event[] = []
  for (let i = 0; i < 5; i++) events.push(edit(T0 + s(i * 3), [3], 2, 'cosmetic' as never))
  events.push(run(T0 + s(16), errRun('IndentationError', 3)))
  events.push(run(T0 + s(20), errRun('IndentationError', 3)))
  events.push(run(T0 + s(24), errRun('IndentationError', 3)))
  const r = score({ now: T0 + s(26), events, lastEditAt: T0 + s(12), lastActivityAt: T0 + s(24), cosmeticStreak: 3, revertedAt: T0 + s(12) })
  const keys = r.contributions.map((c) => c.key)
  check('line revisits detected', keys.includes('thrashLines'))
  check('made-and-undone detected', keys.includes('undoRevert'))
  check('same error repeated detected', keys.includes('repeatedError'))
  check('no-semantic-change detected', keys.includes('noSemantic'))
  check('guessing crosses the threshold', r.score > 0.6, r.score.toFixed(2))

  const stale = score({ now: T0 + s(60), events, lastEditAt: T0 + s(12), lastActivityAt: T0 + s(24), cosmeticStreak: 3, revertedAt: T0 + s(12) })
  check('thrash ages out of its 30s window', !stale.contributions.some((c) => c.key === 'thrashLines'))
}

console.log('\n--- Corroboration, not hair-triggers ------------------------------')
{
  const cosmetic = score({ now: T0 + s(10), events: [edit(T0, [3], 1, 'cosmetic' as never)], lastEditAt: T0, lastActivityAt: T0, cosmeticStreak: 4 })
  check('cosmetic edits alone never reach threshold', cosmetic.score < 0.6, cosmetic.score.toFixed(2))
  const revisits: Event[] = []
  for (let i = 0; i < 6; i++) revisits.push(edit(T0 + s(i * 2), [3], 3))
  const t = score({ now: T0 + s(12), events: revisits, lastEditAt: T0 + s(10), lastActivityAt: T0 + s(10) })
  check('line revisits alone never reach threshold', t.score < 0.6, t.score.toFixed(2))
}

console.log('\n--- Gate ----------------------------------------------------------')
{
  const c = cfg()
  const fresh = (): GateState => ({ lastInterventionAt: null, used: 0 })

  check('open when score clears threshold', evaluateGate(T0, 0.7, s(10), fresh(), c).allowed)
  check('shut when score is under', !evaluateGate(T0, 0.5, s(10), fresh(), c).allowed)

  const justSpoke: GateState = { lastInterventionAt: T0, used: 1 }
  const g1 = evaluateGate(T0 + s(20), 0.9, s(20), justSpoke, c)
  check('cooldown blocks a second intervention at 20s', !g1.allowed, g1.reason)
  check('cooldown clears at 46s', evaluateGate(T0 + s(46), 0.9, s(46), justSpoke, c).allowed)

  const spent: GateState = { lastInterventionAt: T0, used: 8 }
  const g2 = evaluateGate(T0 + s(200), 0.99, s(200), spent, c)
  check('budget of 8 is a hard stop', !g2.allowed, g2.reason)
  check('...even at the hard idle ceiling', !evaluateGate(T0 + s(400), 0.0, s(400), spent, c).allowed)

  const g3 = evaluateGate(T0 + s(200), 0.1, s(185), fresh(), c)
  check('hard idle ceiling fires at 3min regardless of score', g3.allowed && g3.trigger === 'hardIdle', g3.reason)

  const g4 = evaluateGate(T0 + s(200), 0.8, s(10), fresh(), c)
  check('score trigger reported as score', g4.trigger === 'score', String(g4.trigger))
}

console.log(failures === 0 ? '\nALL OBSERVER SCENARIOS PASSED' : `\n${failures} SCENARIO(S) FAILED`)
process.exit(failures ? 1 : 0)
