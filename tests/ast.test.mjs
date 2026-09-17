import { readFileSync } from 'node:fs'
import { loadPyodide } from 'pyodide'
const ts = readFileSync(new URL('../src/exec/harness.ts', import.meta.url), 'utf8')
const pick = (name) => { const m = `export const ${name} = \`` ; const i = ts.indexOf(m) + m.length; return ts.slice(i, ts.indexOf('`', i)) }
const py = await loadPyodide()
py.runPython(pick('HARNESS')); py.runPython(pick('AST_HARNESS'))
const snap = (s) => JSON.parse(py.globals.get('_teaching_ide_ast')(s))

const base = 'nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n)\n'
const cases = {
  'identical':        base,
  'trailing spaces':  'nums = [3, 7, 12, 5]   \nfor n in nums:\n    print(n)\n',
  'blank line added': 'nums = [3, 7, 12, 5]\n\nfor n in nums:\n    print(n)\n',
  'comment added':    'nums = [3, 7, 12, 5]\n# loop\nfor n in nums:\n    print(n)\n',
  'rename n->num':    'nums = [3, 7, 12, 5]\nfor num in nums:\n    print(num)\n',
  'real change':      'nums = [3, 7, 12, 5]\nfor n in nums:\n    print(n * 2)\n',
  'indent moved out': 'nums = [3, 7, 12, 5]\nfor n in nums:\n    pass\nprint(n)\n',
  'broken':           'nums = [3, 7, 12, 5]\nfor n in nums\n    print(n)\n',
}
const b = snap(base)
let fails = 0
const expect = { 'identical':'cosmetic','trailing spaces':'cosmetic','blank line added':'cosmetic','comment added':'cosmetic','rename n->num':'rename','real change':'changed','indent moved out':'changed','broken':'unparseable' }
for (const [name, src] of Object.entries(cases)) {
  const s = snap(src)
  const verdict = !s.parses ? 'unparseable' : s.dump === b.dump ? 'cosmetic' : s.shape === b.shape ? 'rename' : 'changed'
  const ok = verdict === expect[name]
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} -> ${verdict}${ok ? '' : ` (expected ${expect[name]})`}`)
}
console.log(fails ? `\n${fails} FAILED` : '\nAST VERDICTS ALL CORRECT')
process.exit(fails ? 1 : 0)
