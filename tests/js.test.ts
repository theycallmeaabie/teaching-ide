/**
 * The JavaScript runtime and analysis, outside the browser: what it prints,
 * which line an error is on, how edits are classified, and which beginner
 * mistakes it spots. Run with `npm test js`.
 */
import { runJavaScript } from '../src/exec/js/run'
import { jsAstSnapshot, jsDiagnose } from '../src/exec/js/analyze'

let failures = 0
function check(name: string, pass: boolean, detail = '') {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  . ' + detail : ''}`)
}
const ids = (src: string) => jsDiagnose(src).map((m) => m.id).sort()

console.log('--- Running it --------------------------------------------------')
let r = runJavaScript('console.log("Hello, world!")')
check('prints a line', r.ok && r.stdout === 'Hello, world!\n', JSON.stringify(r.stdout))
r = runJavaScript('const nums = [3, 7, 12, 5]\nfor (const n of nums) {\n  console.log(n)\n}')
check('a loop prints each value', r.stdout === '3\n7\n12\n5\n', JSON.stringify(r.stdout))
check('several arguments are joined by a space', runJavaScript('console.log("a", 1, true)').stdout === 'a 1 true\n')
check('an array prints the way Node prints it', runJavaScript('console.log([1, "two", [3]])').stdout === "[ 1, 'two', [ 3 ] ]\n", JSON.stringify(runJavaScript('console.log([1, "two", [3]])').stdout))
check('an object too', runJavaScript('console.log({ a: 1, b: "x" })').stdout === "{ a: 1, b: 'x' }\n")
check('division gives a plain number, not 15.0', runJavaScript('console.log((10 + 15 + 20) / 3)').stdout === '15\n')
check('each run starts clean', runJavaScript('let fresh = 1').ok && runJavaScript('let fresh = 1').ok)

console.log('\n--- Errors point at THEIR line ------------------------------------')
r = runJavaScript('const a = 1\nconst b = 2\nconsole.log(c)')
check('a ReferenceError is reported as such', r.error?.type === 'ReferenceError' && /c is not defined/.test(r.error.message), `${r.error?.type}: ${r.error?.message}`)
check('...on the line they wrote it', r.error?.line === 3, `line ${r.error?.line}`)
r = runJavaScript('function f() {\n  return missing.thing\n}\nconsole.log(f())')
check('an error inside a function is reported where it happened', r.error?.line === 2, `line ${r.error?.line}`)
r = runJavaScript('console.log("before")\nnull.x')
check('output before the error is kept', r.stdout === 'before\n' && r.error?.type === 'TypeError')
r = runJavaScript('const total = 0\nfor (const n of [1, 2]) {\n  total = total + n\n}')
check('reassigning a const is a TypeError on that line', r.error?.type === 'TypeError' && r.error.line === 3, `${r.error?.message} line ${r.error?.line}`)
r = runJavaScript('x = 5')
check('strict mode: assigning to an undeclared name is an error, not a silent global', r.error?.type === 'ReferenceError', r.error?.message)
r = runJavaScript('const a = 1\nif (a > 0 {\n  console.log(a)\n}')
check('a syntax error is caught before running', r.error?.type === 'SyntaxError' && r.stdout === '')
check('...with its line', r.error?.line === 2, `line ${r.error?.line}: ${r.error?.message}`)
check('...and the parser position stripped from the message', !/\(\d+:\d+\)/.test(r.error?.message ?? ''), r.error?.message)
r = runJavaScript('throw "boom"')
check('throwing a non-Error is still reported', r.error?.type === 'Error' && /boom/.test(r.error.message))
r = runJavaScript('let i = 0\nwhile (i < 1e9) { console.log(i++) }')
check('runaway output is capped, not unbounded', r.stdout.length < 210_000 && /truncated/.test(r.stdout), `${r.stdout.length} chars`)
check('prompt() does not exist here, and says so', runJavaScript('const name = prompt("name?")').error?.type === 'ReferenceError')

console.log('\n--- How an edit is classified (cosmetic / rename / changed) ---------')
const base = 'const nums = [3, 7]\nfor (const n of nums) {\n  console.log(n)\n}\n'
const verdict = (src: string) => {
  const a = jsAstSnapshot(base), b = jsAstSnapshot(src)
  if (!b.parses) return 'unparseable'
  return b.dump === a.dump ? 'cosmetic' : b.shape === a.shape ? 'rename' : 'changed'
}
check('identical is cosmetic', verdict(base) === 'cosmetic')
check('a comment is cosmetic', verdict(base + '// done\n') === 'cosmetic')
check('different indentation is cosmetic', verdict(base.replace('  console', '    console')) === 'cosmetic')
check('single vs double quotes is cosmetic', verdict(base) === verdict(base.replace('"', "'")))
check('renaming the loop variable is a rename', verdict(base.replace(/\bn\b/g, 'num')) === 'rename', verdict(base.replace(/\bn\b/g, 'num')))
check('renaming does not touch console.log', verdict(base.replace(/\bn\b/g, 'log')) === 'rename')
check('a real change is changed', verdict(base.replace('console.log(n)', 'console.log(n * 2)')) === 'changed')
check('a broken buffer is unparseable', verdict(base.replace('{', '')) === 'unparseable')
const snap = jsAstSnapshot('if (x {')
check('an unparseable snapshot carries the error and line', !snap.parses && snap.type === 'SyntaxError' && snap.line === 1, JSON.stringify(snap))

console.log('\n--- Beginner mistakes it spots ---------------------------------------')
const L = 'const nums = [3, 7, 12, 5]\n'
check('no loop at all', ids(L + 'console.log(nums[0])').includes('no-loop'))
check('a loop of any kind counts', !ids(L + 'nums.forEach((n) => console.log(n))').includes('no-loop'))
check('for...in over an array hands out positions', ids(L + 'for (const n in nums) {\n  console.log(n)\n}').includes('for-in-over-array'))
check('...for...in over an object is fine', !ids('const o = { a: 1 }\nfor (const k in o) {\n  console.log(k)\n}').includes('for-in-over-array'))
check('using the value as a position', ids(L + 'for (const n of nums) {\n  console.log(nums[n])\n}').includes('index-value-confusion'))
check('...a classic counting loop is not that', ids(L + 'for (let i = 0; i < nums.length; i++) {\n  console.log(nums[i])\n}').length === 0, JSON.stringify(ids(L + 'for (let i = 0; i < nums.length; i++) {\n  console.log(nums[i])\n}')))
const inside = L + 'for (const n of nums) {\n  let total = 0\n  total += n\n}\nconsole.log(total)'
check('a running total set up inside the loop', ids(inside).includes('accumulator-init-inside-loop'))
check('...and on the right line', jsDiagnose(inside).find((m) => m.id === 'accumulator-init-inside-loop')?.line === 3)
check('replacing instead of adding', ids(L + 'let total = 0\nfor (const n of nums) {\n  total = n\n}\nconsole.log(total)').includes('accumulator-reassigned'))
check('printing the total inside the loop', ids(L + 'let total = 0\nfor (const n of nums) {\n  total += n\n  console.log(total)\n}').includes('accumulator-printed-inside-loop'))
check('assigning where a comparison was meant', ids('let x = 3\nif (x = 5) {\n  console.log(x)\n}').includes('assign-in-condition'))
check('a function whose value is used but which returns nothing', ids('function double(n) {\n  console.log(n * 2)\n}\nconsole.log(double(21))').includes('missing-return'))
check('...an arrow function with no braces returns, so is fine', !ids('const double = (n) => n * 2\nconsole.log(double(21))').includes('missing-return'))
check('...calling it as a statement is fine', !ids('function hi() {\n  console.log("hi")\n}\nhi()').includes('missing-return'))
const good = L + 'let total = 0\nfor (const n of nums) {\n  total += n\n}\nconsole.log(total)'
check('a correct running total is clean', ids(good).length === 0, JSON.stringify(ids(good)))
check('an unparseable buffer reports nothing', jsDiagnose('for (const n of {').length === 0)

console.log()
if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL JAVASCRIPT RUNTIME CASES PASSED')
