// Exercises the exact Python harness the worker ships, plus the same
// stdout-capture wiring, against a battery of beginner failure modes.
import { readFileSync } from 'node:fs'
import { loadPyodide } from 'pyodide'

const ts = readFileSync(new URL('../src/exec/harness.ts', import.meta.url), 'utf8')
const pick = (n) => { const m = `export const ${n} = \`` ; const i = ts.indexOf(m) + m.length; return ts.slice(i, ts.indexOf('`', i)) }
const HARNESS = pick('HARNESS')

let out = []
const py = await loadPyodide()
py.setStdout({ batched: (s) => out.push(s + '\n') })
py.setStderr({ batched: (s) => out.push(s + '\n') })
py.runPython(HARNESS)
const run = py.globals.get('_teaching_ide_run')

function exec(src) {
  out = []
  const r = JSON.parse(run(src))
  return { ...r, stdout: out.join('') }
}

const cases = [
  ['happy path', 'nums=[3,7,12,5]\nfor n in nums:\n    print(n)\n'],
  ['index/value confusion', 'nums=[3,7,12,5]\nfor i in nums:\n    print(nums[i])\n'],
  ['indentation error', 'nums=[1]\nfor n in nums:\nprint(n)\n'],
  ['name error line 3', 'a=1\nb=2\nprint(c)\n'],
  ['type error', 'print("a" + 1)\n'],
  ['syntax error', 'for n in nums\n    print(n)\n'],
  ['accumulator inside loop (runs, wrong)', 'nums=[3,7,12,5]\nfor n in nums:\n    total = 0\n    total += n\nprint(total)\n'],
  ['zero division deep', 'def f():\n    return 1/0\ndef g():\n    return f()\nprint(g())\n'],
  ['no output', 'x = 1\n'],
  ['namespace is fresh', 'print(x)\n'],
]

let fails = 0
for (const [name, src] of cases) {
  const r = exec(src)
  console.log(`\n== ${name}`)
  console.log(JSON.stringify(r))
}

// explicit assertions
const a = exec('nums=[3,7,12,5]\nfor n in nums:\n    print(n)\n')
if (!(a.ok && a.stdout === '3\n7\n12\n5\n')) { console.log('FAIL happy'); fails++ }
const b = exec('a=1\nb=2\nprint(c)\n')
if (!(b.type === 'NameError' && b.line === 3)) { console.log('FAIL nameerror line'); fails++ }
const c = exec('nums=[1]\nfor n in nums:\nprint(n)\n')
if (!(c.type === 'IndentationError' && c.line === 3)) { console.log('FAIL indent', JSON.stringify(c)); fails++ }
const d = exec('nums=[3,7,12,5]\nfor i in nums:\n    print(nums[i])\n')
if (!(d.type === 'IndexError' && d.line === 3 && d.stdout === '5\n')) { console.log('FAIL index', JSON.stringify(d)); fails++ }
const e = exec('print(x)\n')
if (e.type !== 'NameError') { console.log('FAIL fresh ns'); fails++ }
const f = exec('def f():\n    return 1/0\ndef g():\n    return f()\nprint(g())\n')
if (!(f.type === 'ZeroDivisionError' && f.line === 2)) { console.log('FAIL deepest learner frame', JSON.stringify(f)); fails++ }

console.log(fails === 0 ? '\nALL ASSERTIONS PASSED' : `\n${fails} ASSERTION(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
