import { readFileSync } from 'node:fs'
import { loadPyodide } from 'pyodide'
const ts = readFileSync(new URL('../src/exec/harness.ts', import.meta.url), 'utf8')
const pick = (n) => { const m = `export const ${n} = \`` ; const i = ts.indexOf(m) + m.length; return ts.slice(i, ts.indexOf('`', i)) }
const py = await loadPyodide()
for (const h of ['HARNESS', 'AST_HARNESS', 'DIAGNOSE_HARNESS']) py.runPython(pick(h))
const dx = (s) => JSON.parse(py.globals.get('_teaching_ide_diagnose')(s))

let fails = 0
const check = (name, src, expected) => {
  const got = dx(src).map((d) => d.id).sort()
  const want = [...expected].sort()
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const L = 'nums = [3, 7, 12, 5]\n'

console.log('\n--- the one that runs clean and is still wrong ---')
check('accumulator initialised inside the loop', L + 'for n in nums:\n    total = 0\n    total = total + n\nprint(total)\n',
  ['accumulator-init-inside-loop'])
check('same, with +=', L + 'for n in nums:\n    total = 0\n    total += n\nprint(total)\n',
  ['accumulator-init-inside-loop'])
check('correct accumulator is clean', L + 'total = 0\nfor n in nums:\n    total = total + n\nprint(total)\n', [])
check('correct accumulator with += is clean', L + 'total = 0\nfor n in nums:\n    total += n\nprint(total)\n', [])

console.log('\n--- the rest of the catalogue ---')
check('index/value confusion', L + 'for i in nums:\n    print(nums[i])\n', ['index-value-confusion'])
check('legit index loop is not flagged', L + 'for i in range(len(nums)):\n    print(nums[i])\n', [])
check('range off-by-one (arithmetic)', L + 'for i in range(len(nums) - 1):\n    print(nums[i])\n', ['range-off-by-one'])
check('range off-by-one (starts at 1)', L + 'for i in range(1, len(nums)):\n    print(nums[i])\n', ['range-off-by-one'])
check('accumulator reassigned not accumulated', L + 'total = 0\nfor n in nums:\n    total = n\nprint(total)\n',
  ['accumulator-reassigned'])
check('total printed inside the loop', L + 'total = 0\nfor n in nums:\n    total = total + n\n    print(total)\n',
  ['accumulator-printed-inside-loop'])
check('loop body left outside the loop', L + 'for n in nums:\n    pass\nprint(n)\n', ['loop-body-outside'])
check('no loop at all', L + 'print(nums)\n', ['no-loop'])

console.log('\n--- must not fire on correct solutions ---')
check('exercise 1 solution', L + 'for n in nums:\n    print(n)\n', [])
check('exercise 2 solution', L + 'for n in nums:\n    print(n * 2)\n', [])
check('exercise 4 solution', L + 'count = 0\nfor n in nums:\n    if n > 10:\n        count = count + 1\nprint(count)\n', [])
check('unparseable returns nothing', L + 'for n in nums\n    print(n)\n', [])

console.log('\n--- line numbers ---')
const d = dx(L + 'for n in nums:\n    total = 0\n    total += n\nprint(total)\n')
const ok = d[0].line === 3
if (!ok) fails++
console.log(`${ok ? 'PASS' : 'FAIL'}  points at the offending line  — line ${d[0].line}`)

console.log(fails ? `\n${fails} FAILED` : '\nALL MISCONCEPTION DETECTORS CORRECT')
process.exit(fails ? 1 : 0)
