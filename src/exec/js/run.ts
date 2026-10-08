import { parse } from 'acorn'
import type { RunResult } from '../../types'
import { formatArgs } from './format'

/**
 * Runs a learner's JavaScript and reports it the same way the Python harness
 * does: what it printed, and if it failed, the error's type, message and the
 * line in THEIR code.
 *
 * Pure, and with no DOM: it runs inside a worker in the browser and in Node for
 * the tests. What makes it safe to run unknown code is where it runs, not this
 * function: a worker can be terminated mid-loop, and that is what Stop does.
 */

/** Same cap as the Python worker: `while (true) console.log(x)` must not take
 *  the tab down before Stop is pressed. */
const MAX_OUTPUT_CHARS = 200_000
const FILE = 'learner.js'

/** Strict mode, so a typo'd assignment is an error rather than a silent global. */
const PREAMBLE = '"use strict";\n'

/**
 * How many lines the engine adds before the learner's first line. V8 wraps a
 * `new Function` body in two lines of its own; other engines may not. Measured
 * once, not assumed: throw on the learner's line 1 and see what the stack says.
 */
const LINE_OFFSET: number = (() => {
  try {
    new Function('console', `${PREAMBLE}throw new Error('probe')\n//# sourceURL=${FILE}`)({})
  } catch (e) {
    const m = String((e as Error).stack ?? '').match(/learner\.js:(\d+)/)
    if (m) return Number(m[1]) - 1
  }
  return 3
})()

/** The line of the deepest frame inside the learner's code, if there is one. */
function learnerLine(e: unknown): number | null {
  const m = String((e as Error)?.stack ?? '').match(/learner\.js:(\d+)/)
  if (!m) return null
  const line = Number(m[1]) - LINE_OFFSET
  return line >= 1 ? line : null
}

export function runJavaScript(source: string): RunResult {
  const startedAt = performance.now()
  const elapsed = () => performance.now() - startedAt

  // Parse first. A syntax error thrown by the engine carries no line number;
  // the parser's does, and it is the same mistake.
  try {
    parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true })
  } catch (e) {
    const err = e as Error & { loc?: { line: number } }
    return {
      ok: false,
      stdout: '',
      error: { type: 'SyntaxError', message: err.message.replace(/\s*\(\d+:\d+\)\s*$/, ''), line: err.loc?.line ?? null },
      durationMs: elapsed(),
    }
  }

  let out = ''
  let truncated = false
  const write = (...args: unknown[]) => {
    if (truncated) return
    out += formatArgs(args) + '\n'
    if (out.length > MAX_OUTPUT_CHARS) {
      out = out.slice(0, MAX_OUTPUT_CHARS)
      truncated = true
    }
  }
  const learnerConsole = { log: write, info: write, warn: write, error: write, debug: write }

  try {
    const program = new Function('console', `${PREAMBLE}${source}\n//# sourceURL=${FILE}`)
    program(learnerConsole)
  } catch (e) {
    const isError = e instanceof Error
    return {
      ok: false,
      stdout: out + (truncated ? '\n... output truncated ...\n' : ''),
      error: {
        type: isError ? e.name : 'Error',
        message: isError ? e.message : `Uncaught ${formatArgs([e])}`,
        line: learnerLine(e),
      },
      durationMs: elapsed(),
    }
  }

  return {
    ok: true,
    stdout: out + (truncated ? '\n... output truncated ...\n' : ''),
    error: undefined,
    durationMs: elapsed(),
  }
}
