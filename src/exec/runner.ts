import * as Comlink from 'comlink'
import type { PyodideWorkerApi } from './pyodide.worker'
import type { AstSnapshot, Misconception, RunResult, RunnerStatus } from '../types'

/** After this long, a run is "suspiciously long" and Stop becomes visible. */
export const SLOW_RUN_MS = 3000

type Deferred<T> = {
  promise: Promise<T>
  resolve: (v: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/**
 * Owns the Pyodide worker. The worker is the only place learner code runs, so
 * the page survives `while True:` — Stop terminates and transparently reboots.
 */
class PythonRunner {
  private worker: Worker | null = null
  private api: Comlink.Remote<PyodideWorkerApi> | null = null
  private pending: { d: Deferred<RunResult>; startedAt: number } | null = null
  private listeners = new Set<(s: RunnerStatus) => void>()

  status: RunnerStatus = 'booting'
  runStartedAt: number | null = null

  constructor() {
    this.spawn()
  }

  private spawn() {
    this.worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.api = Comlink.wrap<PyodideWorkerApi>(this.worker)
    this.setStatus('booting')
    this.api
      .ready()
      .then(() => this.setStatus('idle'))
      .catch((err) => {
        console.error('[runner] pyodide boot failed', err)
        this.setStatus('failed')
      })
  }

  private setStatus(s: RunnerStatus) {
    this.status = s
    for (const l of this.listeners) l(s)
  }

  subscribe(fn: (s: RunnerStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => this.listeners.delete(fn)
  }

  /** Resolves once the interpreter is usable. */
  async ready(): Promise<void> {
    if (!this.api) this.spawn()
    await this.api!.ready()
  }

  async run(source: string): Promise<RunResult> {
    if (this.pending) return this.pending.d.promise
    await this.ready()

    const d = deferred<RunResult>()
    const startedAt = performance.now()
    this.pending = { d, startedAt }
    this.runStartedAt = startedAt
    this.setStatus('running')

    this.api!.run(source).then(
      (result) => {
        // A stop() may have already settled and superseded this run.
        if (this.pending?.d !== d) return
        this.pending = null
        this.runStartedAt = null
        this.setStatus('idle')
        d.resolve(result)
      },
      (err) => {
        if (this.pending?.d !== d) return
        this.pending = null
        this.runStartedAt = null
        this.setStatus('idle')
        d.resolve({
          ok: false,
          stdout: '',
          error: { type: 'WorkerError', message: String(err), line: null },
          durationMs: performance.now() - startedAt,
        })
      },
    )

    return d.promise
  }

  /**
   * Structural snapshot for the observer. Refuses while learner code is in
   * flight — that code owns the worker thread and would never yield.
   */
  async astSnapshot(source: string): Promise<AstSnapshot | null> {
    if (this.pending || !this.api) return null
    try {
      return await this.api.astSnapshot(source)
    } catch {
      return null
    }
  }

  /** Known misconception shapes in the buffer. Same worker-busy caveat. */
  async diagnose(source: string): Promise<Misconception[] | null> {
    if (this.pending || !this.api) return null
    try {
      return await this.api.diagnose(source)
    } catch {
      return null
    }
  }

  /** Kills the interpreter mid-run and brings a fresh one back up. */
  stop() {
    const p = this.pending
    this.pending = null
    this.runStartedAt = null

    this.worker?.terminate()
    this.worker = null
    this.api = null

    if (p) {
      p.d.resolve({
        ok: false,
        stdout: '',
        error: {
          type: 'Stopped',
          message:
            'You stopped this run. Output from a stopped run cannot be recovered.',
          line: null,
        },
        durationMs: performance.now() - p.startedAt,
      })
    }

    this.setStatus('restarting')
    this.spawn()
  }

  get isRunning() {
    return this.pending !== null
  }
}

export const runner = new PythonRunner()
