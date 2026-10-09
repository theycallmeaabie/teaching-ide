/**
 * The teacher's words, as they should sound.
 *
 * Hints are written to be read: code sits in `backticks`. A speech engine reads
 * a code span a character at a time, or skips the punctuation that is its whole
 * point ("you need a `:`" comes out as "you need a"). So each span is said the
 * way a teacher beside you would say it: a symbol by its name, a short line the
 * way it is read out ("print total", "if score greater than 10 colon"), and
 * anything longer as "the code on screen", because it is, and spelling it out
 * bracket by bracket teaches nothing.
 */

/** What a symbol is called when it is read out as part of a line. */
const SYMBOLS: Record<string, string> = {
  ':': 'colon',
  ';': 'semicolon',
  ',': 'comma',
  '.': 'dot',
  '=': 'equals',
  '==': 'double equals',
  '!=': 'not equals',
  '===': 'triple equals',
  '!==': 'not triple equals',
  '<': 'less than',
  '>': 'greater than',
  '<=': 'less than or equal to',
  '>=': 'greater than or equal to',
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '**': 'to the power of',
  '/': 'divided by',
  '//': 'floor divided by',
  '%': 'modulo',
  '+=': 'plus equals',
  '-=': 'minus equals',
  '*=': 'times equals',
  '/=': 'divide equals',
  '->': 'arrow',
  '=>': 'arrow',
  '&&': 'double ampersand',
  '||': 'double bar',
  '#': 'hash',
  '_': 'underscore',
  '\\n': 'backslash n',
  '"': 'double quote',
  "'": 'single quote',
  '""': 'empty quotes',
  "''": 'empty quotes',
  '(': 'opening bracket',
  ')': 'closing bracket',
  '()': 'brackets',
  '[': 'opening square bracket',
  ']': 'closing square bracket',
  '[]': 'square brackets',
  '{': 'opening curly brace',
  '}': 'closing curly brace',
  '{}': 'curly braces',
}

/** Alone, a symbol is the key to find, not the sum it does. */
const ALONE: Record<string, string> = {
  '=': 'equals sign',
  '+': 'plus sign',
  '-': 'minus sign',
  '*': 'star',
  '**': 'double star',
  '/': 'slash',
  '//': 'double slash',
  '%': 'percent sign',
}

export const ON_SCREEN = 'the code on screen'

/** More words than this is a line to look at, not to listen to. */
const MAX_WORDS = 7

/** The pieces of a short line. Anything else (square brackets, a dict, an
 *  f-string) is not read out at all. */
const TOKEN =
  /\s*(<\w+>|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|===|!==|==|!=|<=|>=|\*\*|\/\/|[-+*/]=|->|=>|&&|\|\||[-+*/%<>=:,()])/y

const isWords = (s: string) => /^[A-Za-z0-9 ,.!?]*$/.test(s.replace(/(\w)'(\w)/g, '$1$2'))

/** `my_list.append` as "my list dot append". */
const name = (s: string) => s.replace(/\./g, ' dot ').replace(/_+/g, ' ').trim()

/** One piece of a line as it is said, '' for one that is not, null for one
 *  that cannot be. */
function word(t: string): string | null {
  if (/^<\w+>$/.test(t)) return name(t.slice(1, -1)) // a placeholder: <name>
  if (/^["']/.test(t)) {
    const inner = t.slice(1, -1)
    // "print hello in quotes" is how it is said; a string of punctuation is not.
    return /[A-Za-z]/.test(inner) ? `${inner} in quotes` : null
  }
  if (/^-?\d/.test(t)) return t
  if (/^\.?[A-Za-z_]/.test(t)) return name(t)
  if (t === '(' || t === ')') return '' // "print total", not "print opening bracket total"
  if (t === ',') return ','
  return SYMBOLS[t] ?? null
}

/** A short line read out piece by piece, or null if it is not one. */
function readLine(c: string): string | null {
  const said: string[] = []
  TOKEN.lastIndex = 0
  let at = 0
  while (at < c.length) {
    const m = TOKEN.exec(c)
    if (!m) return null
    at = TOKEN.lastIndex
    const w = word(m[1])
    if (w == null) return null
    if (w) said.push(w)
  }
  if (!said.length || said.filter((w) => w !== ',').length > MAX_WORDS) return null
  return said.join(' ').replace(/ ,/g, ',')
}

/** One code span, without its backticks, as it should be said. */
export function sayCode(code: string): string {
  const c = code.trim()
  if (!c) return ON_SCREEN
  if (c in ALONE) return ALONE[c]
  if (c in SYMBOLS) return SYMBOLS[c]
  // Words a hint quotes rather than code ("print `Hello, world!`").
  if (isWords(c)) return c
  return readLine(c) ?? ON_SCREEN
}

/** The teacher's words with each code span said aloud, on one line. */
export function spoken(text: string): string {
  return text
    .replace(/`([^`]*)`/g, (_, code: string) => sayCode(code))
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A long utterance is cut off part-way in some browsers, and a sentence at a
 *  time pauses where a person would. A sentence longer than this is split at
 *  its commas. */
const MAX_CHARS = 200

/** Text to speak, in the pieces to speak it in. */
export function sentences(text: string): string[] {
  const out: string[] = []
  for (const raw of text.match(/\S[\s\S]*?(?:[.!?]+(?=\s|$)|$)/g) ?? []) {
    const s = raw.trim()
    if (s.length <= MAX_CHARS) {
      out.push(s)
      continue
    }
    let piece = ''
    for (const part of s.split(/(?<=,)\s+/)) {
      if (piece && piece.length + 1 + part.length > MAX_CHARS) {
        out.push(piece)
        piece = part
      } else {
        piece = piece ? `${piece} ${part}` : part
      }
    }
    if (piece) out.push(piece)
  }
  return out.filter(Boolean)
}
