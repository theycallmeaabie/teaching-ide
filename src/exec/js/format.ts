/**
 * How a value looks when `console.log` prints it.
 *
 * Browsers' consoles are interactive and print objects as expandable trees, so
 * there is no single "what the browser shows". This follows Node, which is what
 * a learner will meet next and what most tutorials show: strings bare at the top
 * level and quoted inside a structure, arrays as `[ 1, 2 ]`, objects as
 * `{ a: 1 }`. Deterministic, so an exercise's expected output is unambiguous.
 */

const MAX_DEPTH = 2
const MAX_ITEMS = 100

function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function inner(v: unknown, depth: number, seen: Set<unknown>): string {
  if (typeof v === 'string') return quote(v)
  return show(v, depth, seen)
}

function show(v: unknown, depth: number, seen: Set<unknown>): string {
  if (v === null) return 'null'
  switch (typeof v) {
    case 'string':
      return v
    case 'number':
      return Object.is(v, -0) ? '-0' : String(v)
    case 'bigint':
      return `${v}n`
    case 'boolean':
    case 'undefined':
      return String(v)
    case 'symbol':
      return v.toString()
    case 'function': {
      const name = (v as { name?: string }).name
      return name ? `[Function: ${name}]` : '[Function (anonymous)]'
    }
  }
  if (seen.has(v)) return '[Circular]'
  if (v instanceof Error) return `${v.name}: ${v.message}`
  if (Array.isArray(v)) {
    if (depth > MAX_DEPTH) return '[Array]'
    if (v.length === 0) return '[]'
    seen.add(v)
    const items = v.slice(0, MAX_ITEMS).map((x) => inner(x, depth + 1, seen))
    if (v.length > MAX_ITEMS) items.push(`... ${v.length - MAX_ITEMS} more items`)
    seen.delete(v)
    return `[ ${items.join(', ')} ]`
  }
  if (v instanceof Map) {
    const items = [...v].slice(0, MAX_ITEMS).map(([k, x]) => `${inner(k, depth + 1, seen)} => ${inner(x, depth + 1, seen)}`)
    return `Map(${v.size}) {${items.length ? ` ${items.join(', ')} ` : ''}}`
  }
  if (v instanceof Set) {
    const items = [...v].slice(0, MAX_ITEMS).map((x) => inner(x, depth + 1, seen))
    return `Set(${v.size}) {${items.length ? ` ${items.join(', ')} ` : ''}}`
  }
  if (v instanceof Date) return v.toISOString()
  if (depth > MAX_DEPTH) return '[Object]'
  const keys = Object.keys(v as object)
  const ctor = (v as object).constructor
  const label = ctor && ctor !== Object && ctor.name ? `${ctor.name} ` : ''
  if (keys.length === 0) return `${label}{}`
  seen.add(v)
  const items = keys.slice(0, MAX_ITEMS).map((k) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)
    return `${key}: ${inner((v as Record<string, unknown>)[k], depth + 1, seen)}`
  })
  seen.delete(v)
  return `${label}{ ${items.join(', ')} }`
}

/** One `console.log(a, b, c)` call, as the line it prints. */
export function formatArgs(args: unknown[]): string {
  return args.map((a) => show(a, 0, new Set())).join(' ')
}
