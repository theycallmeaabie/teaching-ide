import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { EditorView } from '@codemirror/view'
import { Editor } from './editor/Editor'
import { setDismissHandler, setSpeechEffect, teacherWidgetExtension } from './editor/teacherWidget'
import { OutputPane } from './ui/OutputPane'
import { DevPanel } from './ui/DevPanel'
import { LessonBar } from './ui/LessonBar'
import { ScratchPane } from './ui/ScratchPane'
import { AskBox } from './ui/AskBox'
import { Conversation } from './ui/Conversation'
import { AuthBar } from './ui/AuthBar'
import { ThemeToggle } from './ui/ThemeToggle'
import { readPref, writePref } from './ui/prefs'
import { CodeIcon, EyeIcon, PlayIcon, TerminalIcon } from './ui/icons'
import { Splitter } from './ui/Splitter'
import { useLayout } from './ui/useLayout'
import { runner, SLOW_RUN_MS } from './exec/runner'
import * as observer from './observer/observer'
import { EXERCISES } from './lesson/exercises'
import { submitRun } from './lesson/teaching'
import { dismissSpeech, requestTeaching } from './teacher/bridge'
import { fetchHealth } from './teacher/health'
import { initAuth } from './auth/session'
import { useStore } from './store'

const DEV_KEY = 'teaching-ide:observer'

export default function App() {
  const viewRef = useRef<EditorView | null>(null)
  const slowTimer = useRef<number | null>(null)
  // The observer is the researcher's instrument, not the learner's UI, so it
  // starts closed. The choice is remembered. The observer itself records either way.
  const [devOpen, setDevOpenState] = useState(() => readPref(DEV_KEY) === '1')
  const setDevOpen = useCallback((open: boolean) => {
    setDevOpenState(open)
    writePref(DEV_KEY, open ? '1' : '0')
  }, [])

  const runnerStatus = useStore((s) => s.runnerStatus)
  const lastResult = useStore((s) => s.lastResult)
  const slowRun = useStore((s) => s.slowRun)
  const errorPlain = useStore((s) => s.errorPlain)
  const exerciseIndex = useStore((s) => s.exerciseIndex)
  const bufferEpoch = useStore((s) => s.bufferEpoch)
  const solved = useStore((s) => s.solved)
  const speech = useStore((s) => s.speech)
  const health = useStore((s) => s.health)
  const exercise = EXERCISES[exerciseIndex]

  useEffect(() => runner.subscribe(useStore.getState().setRunnerStatus), [])

  useEffect(() => {
    void fetchHealth().then((h) => useStore.getState().set({ health: h }))
  }, [])

  // Settles immediately into signed-out when Supabase is unconfigured, so the
  // lesson never waits on it.
  useEffect(() => initAuth(), [])

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

  // Sizes the learner can drag. Defaults only apply until they move something,
  // and the code area defaults wider when the example pane is beside the editor.
  const { layout, set: setLayout, commit: commitLayout } = useLayout()
  const workspaceRef = useRef<HTMLElement>(null)
  const codeAreaRef = useRef<HTMLDivElement>(null)
  const codeRowRef = useRef<HTMLDivElement>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const codeW = layout.codeW ?? (scratch ? 70 : 50)
  const editorW = layout.editorW ?? 52
  const dockH = layout.dockH ?? 260
  const widthOf = (el: HTMLElement | null) => el?.getBoundingClientRect().width ?? 0
  const heightOf = (el: HTMLElement | null) => el?.getBoundingClientRect().height ?? 0
  const pct = (px: number, of: HTMLElement | null) => (px / (of?.clientWidth || 1)) * 100

  return (
    <div className={`app ${devOpen ? 'with-dev' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <TerminalIcon size={14} />
          </span>
          Teaching IDE
        </div>
        <div className="topbar-actions">
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
            <PlayIcon size={14} />
            Run
          </button>
          <span className="topbar-sep" />
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setDevOpen(!devOpen)}
            aria-pressed={devOpen}
            title={devOpen ? 'Hide observer' : 'Show observer'}
          >
            <EyeIcon size={18} />
            <span className="sr-only">{devOpen ? 'Hide observer' : 'Observer'}</span>
          </button>
          <ThemeToggle />
          <AuthBar />
        </div>
      </header>

      <LessonBar />

      <main className="workspace" ref={workspaceRef}>
        <div
          className={`code-area ${scratch ? 'with-scratch' : ''}`}
          ref={codeAreaRef}
          style={{ flexBasis: `${codeW}%` }}
        >
          <div className="code-row" ref={codeRowRef}>
            <div
              className="pane editor-pane"
              ref={editorPaneRef}
              style={scratch ? { flex: `0 0 ${editorW}%` } : undefined}
            >
              <div className="pane-head">
                <span className="pane-title tab">
                  <CodeIcon size={15} />
                  main.py
                </span>
                <span className="muted">Ctrl/Cmd+Enter</span>
              </div>
              <div className="pane-body pane-body-flush">
                <Editor
                  initialDoc={exercise.starter}
                  docKey={`${exercise.id}:${bufferEpoch}`}
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
            </div>

            {scratch && (
              <>
                <Splitter
                  orientation="col"
                  label="Resize editor and example"
                  getSize={() => widthOf(editorPaneRef.current)}
                  bounds={() => [200, Math.max(200, (codeRowRef.current?.clientWidth ?? 800) - 160)]}
                  onSize={(px) => setLayout({ editorW: pct(px, codeRowRef.current) })}
                  onCommit={commitLayout}
                  onReset={() => setLayout({ editorW: null })}
                />
                <ScratchPane code={scratch} />
              </>
            )}
          </div>

          <Splitter
            orientation="row"
            grow="backward"
            label="Resize conversation"
            getSize={() => heightOf(dockRef.current)}
            bounds={() => [170, Math.max(170, (codeAreaRef.current?.clientHeight ?? 700) - 160)]}
            onSize={(px) => setLayout({ dockH: px })}
            onCommit={commitLayout}
            onReset={() => setLayout({ dockH: null })}
          />

          {/* Spans the editor and the example pane, so a question can be asked
              from — and answered beside — whichever one the learner is looking at. */}
          <div className="dock" ref={dockRef} style={{ '--dock-h': `${dockH}px` } as CSSProperties}>
            <Conversation />
            <AskBox />
          </div>
        </div>

        <Splitter
          orientation="col"
          label="Resize code and output"
          getSize={() => widthOf(codeAreaRef.current)}
          bounds={() => {
            const min = scratch ? 440 : 300
            return [min, Math.max(min, (workspaceRef.current?.clientWidth ?? 1200) - 240)]
          }}
          onSize={(px) => setLayout({ codeW: pct(px, workspaceRef.current) })}
          onCommit={commitLayout}
          onReset={() => setLayout({ codeW: null })}
        />

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
