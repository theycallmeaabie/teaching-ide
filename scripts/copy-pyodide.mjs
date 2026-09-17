// Copies the minimal Pyodide runtime into public/pyodide so the worker can load
// it from our own origin. Avoids CDN/version-skew between the JS glue and wasm.
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', 'pyodide')
const dest = join(root, 'public', 'pyodide')

const FILES = [
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
  'pyodide.mjs',
]

mkdirSync(dest, { recursive: true })
let copied = 0
for (const f of FILES) {
  const from = join(src, f)
  const to = join(dest, f)
  if (!existsSync(from)) throw new Error(`pyodide dist missing: ${from}`)
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  copyFileSync(from, to)
  copied++
}
console.log(`[copy-pyodide] ${copied} file(s) copied to public/pyodide`)
