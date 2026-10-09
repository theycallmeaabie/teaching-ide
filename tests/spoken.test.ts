/**
 * The teacher's words as they are read aloud: code spans said the way a person
 * would say them, and long text cut where a person would pause. No browser, no
 * model.
 *
 * Run with `npm test spoken`.
 */
import { ON_SCREEN, sayCode, sentences, spoken } from '../src/teacher/spoken'

let failures = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  | got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`)
}

// ------------------------------------------------------------------ one code span
check('a lone symbol is said by its name', sayCode(':'), 'colon')
check('...and so is a pair of brackets', sayCode('()'), 'brackets')
check('alone, an operator is the key to find', [sayCode('='), sayCode('*'), sayCode('/')], ['equals sign', 'star', 'slash'])
check('a keyword is said as the word', sayCode('def'), 'def')
check('a name loses its underscores', sayCode('my_list'), 'my list')
check('a call with no arguments is said as its name', sayCode('print()'), 'print')
check('a method is said with its dot', sayCode('my_list.append'), 'my list dot append')
check('...even without the thing before it', sayCode('.append()'), 'dot append')
check('a number is said as a number', sayCode('3.5'), '3.5')
check('quoted words are said as words', sayCode('Hello, world!'), 'Hello, world!')
check('contractions in quoted words survive', sayCode("don't stop"), "don't stop")
check('a short line is read out', sayCode('total = total + n'), 'total equals total plus n')
check('...with the sum it does', sayCode('return n * 2'), 'return n times 2')
check('...and the comparison named', sayCode('if score >= 60:'), 'if score greater than or equal to 60 colon')
check('...and the colon that ends it', sayCode('else:'), 'else colon')
check('a call is said the way a teacher says it', sayCode('print(total)'), 'print total')
check('...with a string in quotes', sayCode('print("Hello")'), 'print Hello in quotes')
check('...and its arguments apart', sayCode('range(1, 10)'), 'range 1, 10')
check('a placeholder is said as the thing it stands for', sayCode('for <name> in nums:'), 'for name in nums colon')
check('a string alone is said in quotes', sayCode('"Hello"'), 'Hello in quotes')
check('a negative number is left to the engine', sayCode('x = -1'), 'x equals -1')
check('square brackets are pointed at, not spelled out', sayCode('print(nums[0])'), ON_SCREEN)
check('so is a string of punctuation', sayCode('print("Hello, " + name + "!")'), ON_SCREEN)
check('so is a line too long to follow by ear', sayCode('print((a + b + c) / 3)'), ON_SCREEN)
check('an empty span is pointed at', sayCode('  '), ON_SCREEN)

// ------------------------------------------------------------------ whole sentences
check(
  'every span in a hint is said, and the backticks go',
  spoken('Put a `:` at the end of `for i in range(3)`, then try `print(nums[0])`.'),
  `Put a colon at the end of for i in range 3, then try ${ON_SCREEN}.`,
)
check('text with no code is untouched', spoken('Read the error again.'), 'Read the error again.')
check('a stray backtick is dropped', spoken('Look at line 2`'), 'Look at line 2')
check('line breaks become spaces', spoken('First this.\n\nThen that.'), 'First this. Then that.')

// ------------------------------------------------------------------ pieces
check('one piece per sentence', sentences('Look at line 2. Run it! Did it work?'), ['Look at line 2.', 'Run it!', 'Did it work?'])
check('a decimal point does not end a sentence', sentences('It prints 3.5 here. Then stops.'), ['It prints 3.5 here.', 'Then stops.'])
check('a last sentence with no full stop is kept', sentences('Try it. Then look'), ['Try it.', 'Then look'])
check('nothing to say is no pieces', sentences('   '), [])

const long = Array.from({ length: 12 }, (_, i) => `this is part number ${i + 1} of a very long sentence`).join(', ') + '.'
const pieces = sentences(long)
check('a very long sentence is cut at its commas', pieces.length > 1 && pieces.every((p) => p.length <= 200), true)
check('...losing nothing', pieces.join(' '), long)

console.log(failures ? `\n${failures} FAILED` : '\nALL SPOKEN CASES PASSED')
process.exit(failures ? 1 : 0)
