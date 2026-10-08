/**
 * The long dash, taken out of the teacher's words on the way in. No browser, no
 * model.
 *
 * Run with `npm test plain`.
 */
import { plain } from '../src/teacher/plain'

let failures = 0
function check(name: string, got: string, want: string) {
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  | got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`)
}

// Built from its code point so that this file, like the rest of the source, has none in it.
const D = String.fromCharCode(0x2014)

check('a spaced dash becomes a comma', plain(`type it ${D} the quotes matter`), 'type it, the quotes matter')
check('an unspaced dash does too', plain(`type it${D}the quotes matter`), 'type it, the quotes matter')
check('two in one sentence', plain(`Two things ${D} measuring and printing ${D} happen here`), 'Two things, measuring and printing, happen here')
check('a dash before a full stop leaves no stray comma', plain(`Run it ${D}.`, true), 'Run it.')
check('a dash before a question mark neither', plain(`Does it print ${D}?`, true), 'Does it print?')
check('a trailing dash is dropped, once the text is final', plain(`Try again ${D}`, true), 'Try again')
check('...but not while it is still arriving, when more may follow', plain(`Try again ${D}`), 'Try again, ')
check('a leading dash is dropped', plain(`${D} then run it`, true), 'then run it')
check('doubled dashes do not double the comma', plain(`a ${D}${D} b`), 'a, b')
check('text with no dash is untouched', plain('Print `Hello, world!` on one line.', true), 'Print `Hello, world!` on one line.')
check('commas the model wrote itself are untouched', plain('first, second, third', true), 'first, second, third')
check('code spans are untouched', plain('Type `print("a, b")` yourself.', true), 'Type `print("a, b")` yourself.')

// Streaming, the way the app does it: each chunk is appended to what is already
// shown and the whole is normalised again. Cutting the stream anywhere, including
// between a dash and its spaces, must give the same words.
const full = `Look at line 2 ${D} the quotes ${D} and then try it`
const want = 'Look at line 2, the quotes, and then try it'
const bad: number[] = []
for (let cut = 1; cut < full.length; cut++) {
  const shown = plain(full.slice(0, cut))
  if (plain(plain(shown + full.slice(cut)), true) !== want) bad.push(cut)
}
check('the same words arrive however the stream is cut', bad.length === 0 ? want : `differs when cut at ${bad.join(',')}`, want)

let shown = ''
for (const chunk of ['Look at line 2 ', D, ' the quotes ', D, ' and then try it']) shown = plain(shown + chunk)
check('a dash that arrives alone, in its own chunk, is handled', plain(shown, true), want)

console.log(failures ? `\n${failures} FAILED` : '\nALL PLAIN CASES PASSED')
process.exit(failures ? 1 : 0)
