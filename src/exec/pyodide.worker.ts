/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import type { AstSnapshot, Misconception, RunResult } from '../types'
import { AST_HARNESS, DIAGNOSE_HARNESS, HARNESS } from './harness'

// Cap captured output so a runaway `while True: print(x)` cannot exhaust worker
// memory before the learner reaches the Stop button.
const MAX_OUTPUT_CHARS = 200_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pyodide = any

let pyodide: Pyodide | null = null
let bootPromise: Promise<void> | null = null

let outChars = 0
let outParts: string[] = []
let truncated = false

function collect(text: string) {
  if (outChars >= MAX_OUTPUT_CHARS) {
    truncated = true
    return
  }
  outParts.push(text)
  outChars += text.length
}



async function boot(): Promise<void> {
  // Runtime URL keeps Vite's import analyser out of pyodide's ESM entry.
  const entry = new URL('/pyodide/pyodide.mjs', self.location.origin).href
  const mod = await import(/* @vite-ignore */ entry)
  pyodide = await mod.loadPyodide({ indexURL: '/pyodide/' })

  pyodide.setStdout({ batched: (s: string) => collect(s + '\n') })
  pyodide.setStderr({ batched: (s: string) => collect(s + '\n') })
  // input() is meaningless here; make it a clean EOFError rather than a hang.
  pyodide.setStdin({ stdin: () => null })

  pyodide.runPython(HARNESS)
  pyodide.runPython(AST_HARNESS)
  pyodide.runPython(DIAGNOSE_HARNESS)
}

const api = {
  async ready(): Promise<void> {
    if (!bootPromise) bootPromise = boot()
    return bootPromise
  },

  async run(source: string): Promise<RunResult> {
    await api.ready()
    outParts = []
    outChars = 0
    truncated = false

    const started = performance.now()
    let raw: string
    try {
      raw = pyodide!.globals.get('_teaching_ide_run')(source) as string
    } catch (err) {
      // A failure here is ours, not the learner's.
      return {
        ok: false,
        stdout: outParts.join(''),
        error: { type: 'HarnessError', message: String(err), line: null },
        durationMs: performance.now() - started,
      }
    }
    const durationMs = performance.now() - started
    const parsed = JSON.parse(raw) as {
      ok: boolean
      type: string | null
      message: string | null
      line: number | null
    }

    let stdout = outParts.join('')
    if (truncated) stdout += '\n... output truncated ...\n'

    if (parsed.ok) return { ok: true, stdout, durationMs }
    return {
      ok: false,
      stdout,
      error: {
        type: parsed.type ?? 'Error',
        message: parsed.message ?? '',
        line: parsed.line,
      },
      durationMs,
    }
  },

  /**
   * Structural snapshot of the buffer. Cheap (~1ms) and safe to call on every
   * edit batch — but the caller must not call it while a run is in flight, as
   * learner code blocks this thread.
   */
  async astSnapshot(source: string): Promise<AstSnapshot> {
    await api.ready()
    const raw = pyodide!.globals.get('_teaching_ide_ast')(source) as string
    return JSON.parse(raw) as AstSnapshot
  },

  /** Known misconception shapes present in the buffer right now. */
  async diagnose(source: string): Promise<Misconception[]> {
    await api.ready()
    const raw = pyodide!.globals.get('_teaching_ide_diagnose')(source) as string
    return JSON.parse(raw) as Misconception[]
  },
}

export type PyodideWorkerApi = typeof api

Comlink.expose(api)
