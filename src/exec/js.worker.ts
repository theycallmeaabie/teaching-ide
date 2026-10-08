import * as Comlink from 'comlink'
import type { AstSnapshot, Misconception, RunResult } from '../types'
import { jsAstSnapshot, jsDiagnose } from './js/analyze'
import { runJavaScript } from './js/run'

/**
 * The JavaScript twin of pyodide.worker.ts, with the same four methods so the
 * runner can treat both languages alike.
 *
 * Learner code runs here and never on the page itself: a worker has no DOM to
 * damage, and `while (true) {}` only ever freezes this thread, which Stop
 * terminates and replaces. There is nothing to boot, so it is ready at once.
 */
const api = {
  async ready(): Promise<void> {},
  async run(source: string): Promise<RunResult> {
    return runJavaScript(source)
  },
  async astSnapshot(source: string): Promise<AstSnapshot> {
    return jsAstSnapshot(source)
  },
  async diagnose(source: string): Promise<Misconception[]> {
    return jsDiagnose(source)
  },
}

export type JsWorkerApi = typeof api

Comlink.expose(api)
