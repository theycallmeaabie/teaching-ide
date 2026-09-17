import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Editor } from './editor/Editor'
import { setDismissHandler, setSpeechEffect, teacherWidgetExtension } from './editor/teacherWidget'
import { OutputPane } from './ui/OutputPane'
import { DevPanel } from './ui/DevPanel'
import { LessonBar } from './ui/LessonBar'
import { ScratchPane } from './ui/ScratchPane'
import { AskBox } from './ui/AskBox'
import { runner, SLOW_RUN_MS } from './exec/runner'
import * as observer from './observer/observer'
import { EXERCISES } from './lesson/exercises'
import { submitRun } from './lesson/teaching'
import { dismissSpeech, requestTeaching } from './teacher/bridge'
import { fetchHealth } from './teacher/health'
import { useStore } from './store'

export default function App() {
  const viewRef = useRef<EditorView | null>(null)
  const slowTimer = useRef<number | null>(null)
  const [devOpen, setDevOpen] = useState(true)

  const runnerStatus = useStore((s) => s.runnerStatus)
  const lastResult = useStore((s) => s.lastResult)
  const slowRun = useStore((s) => s.slowRun)
  const errorPlain = useStore((s) => s.errorPlain)
  const exerciseIndex = useStore((s) => s.exerciseIndex)
  const solved = useStore((s) => s.solved)
  const speech = useStore((s) => s.speech)
  const health = useStore((s) => s.health)
  const exercise = EXERCISES[exerciseIndex]

  useEffect(() => runner.subscribe(useStore.getState().setRunnerStatus), [])

  useEffect(() => {
    void fetchHealth().then((h) => useStore.getState().set({ health: h }))
  }, [])

  useEffect(() => {
    observer.setStarter(EXERCISES[0].starter)
    observer.setInterveneHandler(() => void requestTeaching('gate'))
    setDismissHandler(dismissSpeech)
    observer.start()
    return () => {
      observer.setInterveneHandler(null)
      setDismissHandler(null)
      observer.stop()
    }
  }, [])

  // A worker restart invalidates the AST baseline the observer compares against.
  useEffect(
    () =>
      runner.subscribe((s) => {
        if (s === 'restarting') observer.handleWorkerRestart()
      }),
    [],
  )

  // The teacher lives inside the editor, so speech is pushed in as an effect
  // rather than rendered beside it.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setSpeechEffect.of(speech) })
  }, [speech])

  const handleRun = useCallback(async () => {
    const view = viewRef.current
    if (!view || runner.isRunning) return
    const { setLastResult, setSlowRun } = useStore.getState()
    const source = view.state.doc.toString()

    setLastResult(null)
    setSlowRun(false)
    slowTimer.current = window.setTimeout(() => setSlowRun(true), SLOW_RUN_MS)

    const result = await runner.run(source)

    if (slowTimer.current) window.clearTimeout(slowTimer.current)
    setSlowRun(false)
    setLastResult(result)
    void submitRun(result, source)
  }, [])

  const handleStop = useCallback(() => runner.stop(), [])

  const busy = runnerStatus === 'running'
  const booting = runnerStatus === 'booting' || runnerStatus === 'restarting'
  const scratch = speech?.scratch

  return (
    <div className={`app ${devOpen ? 'with-dev' : ''}`}>
      <header className="topbar">
        <div className="brand">Teaching IDE</div>
        <div className="topbar-actions">
          <button className="btn btn-ghost small" onClick={() => setDevOpen((v) => !v)}>
            {devOpen ? 'Hide observer' : 'Observer'}
          </button>
          {health && (health.degraded || !health.reachable) && (
            <span
              className="degraded"
              title={
                health.reason
                  ? `${health.reason}${health.retryAfterS ? ` — retry in ~${Math.ceil(health.retryAfterS / 60)} min` : ''}`
                  : 'teacher unavailable'
              }
            >
              hints: pre-written{health.reason ? ` · ${health.reason}` : ''}
            </span>
          )}
          <span className={`status status-${runnerStatus}`}>
            {runnerStatus === 'booting' && 'starting Python…'}
            {runnerStatus === 'restarting' && 'restarting Python…'}
            {runnerStatus === 'idle' && 'ready'}
            {runnerStatus === 'running' && 'running'}
            {runnerStatus === 'failed' && 'Python failed to start'}
          </span>
          {(slowRun || busy) && (
            <button className={`btn ${slowRun ? 'btn-danger' : 'btn-ghost'}`} onClick={handleStop}>
              Stop
            </button>
          )}
          <button className="btn btn-primary" onClick={handleRun} disabled={busy || booting}>
            Run
          </button>
        </div>
      </header>

      <LessonBar />

      <main className={`workspace ${scratch ? 'with-scratch' : ''}`}>
        <div className="pane editor-pane">
          <div className="pane-head">
            <span>main.py</span>
            <span className="muted">Ctrl/Cmd+Enter</span>
          </div>
          <div className="pane-body pane-body-flush">
            <Editor
              initialDoc={exercise.starter}
              docKey={exercise.id}
              extensions={[observer.editorExtension(), teacherWidgetExtension()]}
              onRunShortcut={handleRun}
              onViewReady={(v) => {
                viewRef.current = v
                if (import.meta.env.DEV) {
                  ;(window as unknown as { __editorView?: EditorView }).__editorView = v
                }
              }}
            />
          </div>
          <AskBox />
        </div>

        {scratch && <ScratchPane code={scratch} />}

        <div className="pane output-column">
          <OutputPane result={lastResult} busy={busy} errorPlain={errorPlain} />
          {solved[exerciseIndex] && (
            <div className="solved-banner">
              That is exactly it — {exercise.expectedStdout.split('\n').join(', ')}.
            </div>
          )}
        </div>
      </main>

      {devOpen && <DevPanel onClose={() => setDevOpen(false)} />}

      {slowRun && (
        <div className="slow-banner">
          This has been running for over {SLOW_RUN_MS / 1000}s — it may be an infinite loop.{' '}
          <button onClick={handleStop}>Stop it</button>
        </div>
      )}
    </div>
  )
}
