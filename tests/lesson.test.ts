/**
 * The learner profile and the "did my last hint land?" rule. Pure logic, no
 * browser. Run with `npm test lesson`.
 */
import { buildProfile, MISCONCEPTION_LABELS, type ExerciseStat } from '../src/lesson/profile'
import { escalatedTier, hashBuffer, lastHintFailed } from '../src/teacher/escalation'
import { EXERCISES } from '../src/lesson/exercises'

let failures = 0
function check(name: string, pass: boolean, detail = '') {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const stat = (id: string, over: Partial<ExerciseStat> = {}): ExerciseStat => ({
  exercise_id: id, solved: false, tier: 1, attempts: 0, begs: 0, seen: [], ...over,
})
const solvedEasy = (id: string) => stat(id, { solved: true })

console.log('--- A new learner has no profile ------------------------------')
check('no history, no profile', buildProfile([]) === null)
check('visiting an exercise without doing anything is still nothing', buildProfile([stat('say-hello')]) === null)

console.log('\n--- Progress ---------------------------------------------------')
let p = buildProfile([solvedEasy('say-hello'), solvedEasy('two-lines'), stat('greet-by-name')])!
check('counts what is solved', p.solved === 2 && p.total === EXERCISES.length, `${p.solved}/${p.total}`)
check('ignores ids that are no longer in the ramp', buildProfile([solvedEasy('long-gone-exercise')]) === null)

console.log('\n--- What took effort -------------------------------------------')
p = buildProfile([stat('add-two', { solved: true, tier: 3 })])!
check('reaching the concept rung counts as struggling', p.struggled.includes('Add two numbers'), JSON.stringify(p.struggled))
p = buildProfile([stat('add-two', { solved: true, attempts: 4 })])!
check('so does a lot of attempts', p.struggled.length === 1)
p = buildProfile([stat('add-two', { solved: true, tier: 2, attempts: 3 })])!
check('a nudge and a pointer do not', p.struggled.length === 0)
const many = ['say-hello', 'two-lines', 'greet-by-name', 'add-two', 'rectangle-area'].map((id) => stat(id, { solved: true, tier: 4 }))
p = buildProfile(many)!
check('only the three most recent are reported', p.struggled.length === 3 && p.struggled.at(-1) === 'Area of a rectangle', JSON.stringify(p.struggled))

console.log('\n--- Mistakes that keep happening -------------------------------')
p = buildProfile([
  stat('sum-them', { seen: ['accumulator-init-inside-loop'] }),
  stat('count-above-ten', { seen: ['accumulator-init-inside-loop', 'accumulator-reassigned'] }),
])!
check('the same mistake in two exercises is a habit', p.recurring.length === 1 && p.recurring[0] === MISCONCEPTION_LABELS['accumulator-init-inside-loop'], JSON.stringify(p.recurring))
check('...and a mistake seen once is not', !p.recurring.some((r) => r.includes('replaces')))
p = buildProfile([stat('sum-them', { seen: ['no-loop', 'no-loop'], solved: true })])!
check('the same mistake twice in ONE exercise is still one data point', p.recurring.length === 0)

console.log('\n--- What came easily -------------------------------------------')
p = buildProfile([solvedEasy('say-hello'), solvedEasy('two-lines')])!
check('a section where everything touched was easy is comfortable', p.comfortable.includes('output'), JSON.stringify(p.comfortable))
p = buildProfile([solvedEasy('say-hello'), stat('two-lines', { attempts: 2 })])!
check('...but not when one of them was a fight', !p.comfortable.includes('output'))
p = buildProfile([stat('say-hello', { solved: true, begs: 1 })])!
check('...or when they asked to be told the answer', !p.comfortable.includes('output'))
p = buildProfile([stat('say-hello', { tier: 2 })])!
check('nothing finished means nothing is comfortable', p === null || p.comfortable.length === 0)

console.log('\n--- Reaching for the answer ------------------------------------')
p = buildProfile([stat('add-two', { solved: true, begs: 2 }), stat('shout-it', { solved: true, begs: 3 })])!
check('begging is summed across exercises', p.begs === 5)

console.log('\n--- A hint that did not land -----------------------------------')
const code = 'nums = [3, 7]\nfor n in nums:\n    total = 0\n'
const given = { hash: hashBuffer(code), tier: 2 }
check('no hint yet, nothing failed', !lastHintFailed(undefined, code))
check('unchanged code after a hint means it did not land', lastHintFailed(given, code))
check('any edit at all means it might have', !lastHintFailed(given, code + ' '))
check('the next hint climbs a rung', escalatedTier(2, given) === 3)
check('...but never past tier 5', escalatedTier(5, { hash: 1, tier: 5 }) === 5)
check('a failed run may already have climbed; it is not climbed twice', escalatedTier(3, given) === 3, '3, not 4')
check('...and it never goes down', escalatedTier(4, given) === 4)
check('hashing is stable', hashBuffer(code) === hashBuffer(code) && hashBuffer(code) !== hashBuffer(code + 'x'))

console.log()
if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL LESSON CASES PASSED')
