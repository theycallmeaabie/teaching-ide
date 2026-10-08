import { parse } from 'acorn'
import type { AstSnapshot, Misconception, MisconceptionId } from '../../types'

/**
 * What the observer and the teacher need to know about a JavaScript buffer:
 * its structure, and the beginner mistakes visible in that structure. The
 * JavaScript twin of the Python harness's `_teaching_ide_ast` and
 * `_teaching_ide_diagnose`, and held to the same contracts.
 *
 *  - `dump` is the syntax tree without positions. Comments and whitespace do
 *    not appear in it, so an edit that only touches those leaves it unchanged.
 *  - `shape` is the same tree with the learner's own names replaced by
 *    v0, v1, ... in order of appearance, so a rename leaves it unchanged too.
 */

// Acorn's own node types are deliberately loose; the walks below only read
// `type` and a handful of fields, so a plain record is the honest type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = { type: string; loc?: { start: { line: number } }; [k: string]: any }

const DROP = new Set(['start', 'end', 'loc', 'range', 'raw'])
const replacer = (k: string, v: unknown) => (DROP.has(k) ? undefined : typeof v === 'bigint' ? `${v}n` : v)

/** Names a learner did not choose, so renaming never touches them. */
const BUILTINS = new Set([
  'console', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date', 'Map', 'Set',
  'Symbol', 'BigInt', 'Error', 'TypeError', 'RangeError', 'Promise', 'RegExp', 'Intl', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'undefined', 'NaN', 'Infinity',
])

function parseProgram(source: string): N {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) as unknown as N
}

const isNode = (v: unknown): v is N => !!v && typeof v === 'object' && typeof (v as N).type === 'string'

function children(n: N): N[] {
  const out: N[] = []
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue
    const v = n[k]
    if (isNode(v)) out.push(v)
    else if (Array.isArray(v)) for (const x of v) if (isNode(x)) out.push(x)
  }
  return out
}

/** Every node, with its parent and the key it sits under. */
function walk(n: N, visit: (node: N, parent: N | null, key: string | null) => void, parent: N | null = null, key: string | null = null) {
  visit(n, parent, key)
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue
    const v = n[k]
    if (isNode(v)) walk(v, visit, n, k)
    else if (Array.isArray(v)) for (const x of v) if (isNode(x)) walk(x, visit, n, k)
  }
}

/** An identifier that names a variable, as opposed to a property or a label. */
function isReference(parent: N | null, key: string | null): boolean {
  if (!parent) return true
  if ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
      ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) ||
      ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label')) {
    return false
  }
  return true
}

function canonical(program: N): N {
  const names = new Map<string, string>()
  const clone = (n: N, parent: N | null, key: string | null): N => {
    const out: N = { type: n.type }
    for (const k of Object.keys(n)) {
      if (DROP.has(k)) continue
      const v = n[k]
      if (isNode(v)) out[k] = clone(v, n, k)
      else if (Array.isArray(v)) out[k] = v.map((x) => (isNode(x) ? clone(x, n, k) : x))
      else out[k] = v
    }
    if (n.type === 'Identifier' && isReference(parent, key) && !BUILTINS.has(n.name)) {
      if (!names.has(n.name)) names.set(n.name, `v${names.size}`)
      out.name = names.get(n.name)
    }
    return out
  }
  return clone(program, null, null)
}

export function jsAstSnapshot(source: string): AstSnapshot {
  let program: N
  try {
    program = parseProgram(source)
  } catch (e) {
    const err = e as Error & { loc?: { line: number } }
    return {
      parses: false,
      dump: null,
      shape: null,
      type: 'SyntaxError',
      message: err.message.replace(/\s*\(\d+:\d+\)\s*$/, ''),
      line: err.loc?.line ?? null,
    }
  }
  return {
    parses: true,
    dump: JSON.stringify(program, replacer),
    shape: JSON.stringify(canonical(program), replacer),
  }
}

// ------------------------------------------------------------ misconceptions

const lineOf = (n: N): number | null => n.loc?.start.line ?? null

function isConsoleLog(n: N): boolean {
  return n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed &&
    n.callee.object.type === 'Identifier' && n.callee.object.name === 'console' && n.callee.property.name === 'log'
}

/** Loops, including `array.forEach(...)`, with the body and the loop variable. */
type Loop = { node: N; body: N; variable: string | null; over: string | null }

function asLoop(n: N): Loop | null {
  const firstDeclared = (d: N | null): string | null =>
    d?.type === 'VariableDeclaration' ? (d.declarations[0]?.id?.name ?? null) : d?.type === 'Identifier' ? d.name : null
  switch (n.type) {
    case 'ForOfStatement':
    case 'ForInStatement':
      return { node: n, body: n.body, variable: firstDeclared(n.left), over: n.right.type === 'Identifier' ? n.right.name : null }
    case 'ForStatement':
      return { node: n, body: n.body, variable: firstDeclared(n.init), over: null }
    case 'WhileStatement':
    case 'DoWhileStatement':
      return { node: n, body: n.body, variable: null, over: null }
    case 'CallExpression': {
      const c = n.callee
      const fn = n.arguments[0]
      if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'forEach' &&
          fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')) {
        return { node: n, body: fn.body, variable: fn.params[0]?.name ?? null, over: c.object.type === 'Identifier' ? c.object.name : null }
      }
      return null
    }
  }
  return null
}

function mentions(n: N, name: string): boolean {
  let found = false
  walk(n, (node, parent, key) => {
    if (!found && node.type === 'Identifier' && node.name === name && isReference(parent, key)) found = true
  })
  return found
}

/** Does this subtree change `name` by building on its old value (`+=`, `x = x + ...`, `x++`)? */
function accumulates(n: N, name: string): boolean {
  let found = false
  walk(n, (node) => {
    if (found) return
    if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier' && node.argument.name === name) found = true
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && node.left.name === name &&
        (node.operator !== '=' || mentions(node.right, name))) found = true
  })
  return found
}

/** `let x = <literal>` declarations inside a subtree. */
function literalDeclarations(n: N): N[] {
  const out: N[] = []
  walk(n, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init?.type === 'Literal') out.push(node)
  })
  return out
}

export function jsDiagnose(source: string): Misconception[] {
  let program: N
  try {
    program = parseProgram(source)
  } catch {
    return []
  }

  const found: Misconception[] = []
  const seen = new Set<string>()
  const flag = (id: MisconceptionId, line: number | null) => {
    const k = `${id}:${line}`
    if (!seen.has(k)) {
      seen.add(k)
      found.push({ id, line })
    }
  }

  const loops: Loop[] = []
  walk(program, (n) => {
    const l = asLoop(n)
    if (l) loops.push(l)
  })
  if (loops.length === 0) flag('no-loop', null)

  // Names bound to an array literal anywhere: `for...in` over one of these
  // hands out positions as strings, which is never what a beginner meant.
  const arrays = new Set<string>()
  walk(program, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'ArrayExpression') arrays.add(n.id.name)
  })

  for (const loop of loops) {
    const { node, body, variable, over } = loop

    if (node.type === 'ForInStatement' && (node.right.type === 'ArrayExpression' || (over && arrays.has(over)))) {
      flag('for-in-over-array', lineOf(node))
    }

    // `for (const n of nums) { ... nums[n] ... }`: treating the value as a position.
    if (variable && over && (node.type === 'ForOfStatement' || node.type === 'CallExpression')) {
      walk(body, (n) => {
        if (n.type === 'MemberExpression' && n.computed && n.object.type === 'Identifier' && n.object.name === over &&
            n.property.type === 'Identifier' && n.property.name === variable) flag('index-value-confusion', lineOf(n))
      })
    }

    // A running total created inside the loop is created again on every pass.
    for (const d of literalDeclarations(body)) {
      if (accumulates(body, d.id.name)) flag('accumulator-init-inside-loop', lineOf(d))
    }

    // Names set to a starting value BEFORE this loop, at the top level.
    const before = program.body.filter((s: N) => (s.end ?? 0) <= (node.start ?? 0))
    const starters = before.flatMap((s: N) => literalDeclarations(s)).map((d: N) => d.id.name as string)

    for (const name of starters) {
      if (accumulates(body, name)) {
        // Printed inside the loop: a running total shown at every step instead of once.
        walk(body, (n) => {
          if (isConsoleLog(n) && n.arguments.some((a: N) => mentions(a, name)) &&
              !(variable && n.arguments.some((a: N) => mentions(a, variable)))) {
            flag('accumulator-printed-inside-loop', lineOf(n))
          }
        })
      } else {
        // Replaced rather than added to: `total = n`.
        walk(body, (n) => {
          if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier' &&
              n.left.name === name && !mentions(n.right, name)) flag('accumulator-reassigned', lineOf(n))
        })
      }
    }
  }

  // `if (x = 5)`: an assignment where a comparison was meant.
  walk(program, (n) => {
    if (['IfStatement', 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ConditionalExpression'].includes(n.type) &&
        n.test?.type === 'AssignmentExpression' && n.test.operator === '=') flag('assign-in-condition', lineOf(n.test))
  })

  // A function whose value is used, but which never hands one back.
  const functions = new Map<string, N>()
  walk(program, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) functions.set(n.id.name, n)
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' &&
        (n.init?.type === 'FunctionExpression' || (n.init?.type === 'ArrowFunctionExpression' && n.init.body.type === 'BlockStatement'))) {
      functions.set(n.id.name, n.init)
    }
  })
  const returnsValue = (fn: N): boolean => {
    let yes = false
    const visit = (n: N, top: boolean) => {
      if (yes) return
      if (!top && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) return
      if (n.type === 'ReturnStatement' && n.argument) {
        yes = true
        return
      }
      for (const c of children(n)) visit(c, false)
    }
    visit(fn, true)
    return yes
  }
  walk(program, (n, parent) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && functions.has(n.callee.name) &&
        parent && parent.type !== 'ExpressionStatement') {
      const fn = functions.get(n.callee.name)!
      if (fn.body?.type === 'BlockStatement' && !returnsValue(fn)) flag('missing-return', lineOf(fn))
    }
  })

  return found
}
