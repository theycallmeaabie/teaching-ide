import { useSyncExternalStore } from 'react'
import {
  CONFIG_FIELDS,
  config,
  resetConfig,
  setConfigValue,
  subscribeConfig,
  type ObserverConfig,
} from '../observer/config'
import * as observer from '../observer/observer'
import { useStore } from '../store'
import type { Event } from '../observer/types'

const clock = (t: number) => {
  const d = new Date(t)
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const fmt = (v: number, unit: 'ms' | 'w' | 'n') =>
  unit === 'ms' ? `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}s` : unit === 'n' ? String(v) : v.toFixed(2)

function describe(e: Event): { kind: string; text: string } {
  switch (e.type) {
    case 'edit':
      return {
        kind: 'edit',
        text: `lines ${e.linesChanged.join(',') || 'none'} · ${e.charDelta >= 0 ? '+' : ''}${e.charDelta} · ${e.semantic ?? '?'}`,
      }
    case 'run':
      return {
        kind: !e.result.ok ? 'run err' : e.correct ? 'run ok' : 'run wrong',
        text: e.result.ok
          ? `${Math.round(e.result.durationMs)}ms · ${e.result.stdout.trim().split('\n').join(' ⏎ ').slice(0, 40) || '(no output)'}`
          : `${e.result.error?.type} line ${e.result.error?.line ?? '?'}`,
      }
    case 'idle':
      return { kind: 'idle', text: `${e.durationMs / 1000}s of silence` }
    case 'ask':
      return { kind: 'ask', text: e.text.slice(0, 48) }
    case 'gate':
      return { kind: 'gate', text: `${e.trigger} · ${e.reason}` }
  }
}

export function DevPanel({ onClose }: { onClose: () => void }) {
  const snap = useSyncExternalStore(observer.subscribe, observer.getSnapshot)
  const speech = useStore((s) => s.speech)
  const lastSilence = useStore((s) => s.lastSilence)
  const askedForAnswer = useStore((s) => s.askedForAnswer)
  const teacherBusy = useStore((s) => s.teacherBusy)
  useSyncExternalStore(subscribeConfig, () => configVersion())

  const pct = Math.round(snap.score * 100)
  const thresholdPct = Math.round(config.threshold * 100)

  const groups = [...new Set(CONFIG_FIELDS.map((f) => f.group))]

  const exportLog = () => {
    const data = observer.log.exportJson({ ...config } as unknown as Record<string, number>)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <aside className="devpanel">
      <div className="dev-head">
        <strong>Observer</strong>
        <button className="linkbtn" onClick={onClose}>
          close
        </button>
      </div>

      <div className="dev-scroll">
        {/* ---------------------------------------------------------- score */}
        <section className="dev-section">
          <div className={`intervene ${snap.gate.allowed ? 'on' : ''}`}>
            {snap.gate.allowed ? 'WOULD INTERVENE NOW' : 'staying silent'}
            <div className="intervene-why">{snap.gate.reason}</div>
          </div>

          <div className="score-row">
            <span className="score-num">{snap.score.toFixed(2)}</span>
            <div className="score-bar">
              <div className="score-fill" style={{ width: `${pct}%` }} />
              <div className="score-threshold" style={{ left: `${thresholdPct}%` }} />
            </div>
          </div>

          <table className="contrib">
            <tbody>
              {snap.contributions.length === 0 && (
                <tr>
                  <td className="muted" colSpan={3}>
                    no signals firing
                  </td>
                </tr>
              )}
              {snap.contributions.map((c) => (
                <tr key={c.key}>
                  <td className={c.value > 0 ? 'pos' : 'neg'}>
                    {c.value > 0 ? '+' : ''}
                    {c.value.toFixed(2)}
                  </td>
                  <td>{c.label}</td>
                  <td className="muted small">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ---------------------------------------------------------- state */}
        <section className="dev-section">
          <div className="kv">
            <span>idle</span>
            <b>{(snap.idleMs / 1000).toFixed(1)}s</b>
            <span>budget left</span>
            <b>
              {snap.gate.budgetRemaining}/{config.budget}
            </b>
            <span>cooldown</span>
            <b>{(snap.gate.cooldownRemainingMs / 1000).toFixed(0)}s</b>
            <span>hint tier</span>
            <b>{snap.hintTier ?? 'none'}</b>
            <span>learner chars</span>
            <b>{snap.learnerChars}</b>
            <span>non-progress</span>
            <b>{snap.cosmeticStreak.toFixed(1)}</b>
            <span>last edit was</span>
            <b>{snap.lastSemantic ?? 'none'}</b>
            <span>events</span>
            <b>{snap.eventCount}</b>
          </div>
          <div className="dev-actions">
            <button className="btn btn-ghost small" onClick={exportLog}>
              Export log
            </button>
            <button
              className="btn btn-ghost small"
              onClick={() => observer.recordAsk('(simulated learner question)')}
            >
              Simulate ask
            </button>
            <button className="btn btn-ghost small" onClick={() => observer.resetSession()}>
              Reset session
            </button>
          </div>
        </section>

        {/* --------------------------------------------------------- teacher */}
        <section className="dev-section">
          <h4>Teacher</h4>
          <div className="kv">
            <span>state</span>
            <b>{teacherBusy ? 'asking…' : speech ? speech.kind : 'quiet'}</b>
            <span>words from</span>
            <b>{speech?.source ?? 'none'}</b>
            <span>target line</span>
            <b>{speech?.targetLine ?? 'none'}</b>
            <span>begged</span>
            <b>{askedForAnswer}</b>
          </div>
          {lastSilence && (
            <p className="silence-reason">
              <span className="muted">last silence / discard:</span> {lastSilence}
            </p>
          )}
        </section>

        {/* -------------------------------------------------- interventions */}
        {snap.interventions.length > 0 && (
          <section className="dev-section">
            <h4>Would have spoken</h4>
            <ul className="fired">
              {snap.interventions.map((v, i) => (
                <li key={i}>
                  <span className="mono small">{clock(v.t)}</span> {v.trigger} · {v.score.toFixed(2)}
                  <div className="muted small">{v.reason}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------- events */}
        <section className="dev-section">
          <h4>Last {snap.recent.length} events</h4>
          <ul className="events">
            {[...snap.recent].reverse().map((e, i) => {
              const d = describe(e)
              return (
                <li key={snap.eventCount - i}>
                  <span className="mono small muted">{clock(e.t)}</span>
                  <span className={`tag tag-${d.kind.replace(' ', '-')} tag-${d.kind.split(' ')[0]}`}>
                    {d.kind}
                  </span>
                  <span className="small">{d.text}</span>
                </li>
              )
            })}
          </ul>
        </section>

        {/* ---------------------------------------------------------- tuning */}
        <section className="dev-section">
          <h4>
            Tuning
            <button className="linkbtn" onClick={resetConfig}>
              reset
            </button>
          </h4>
          {groups.map((g) => (
            <div key={g} className="tune-group">
              <div className="tune-group-name">{g}</div>
              {CONFIG_FIELDS.filter((f) => f.group === g).map((f) => (
                <label key={f.key} className="tune">
                  <span className="tune-label">{f.label}</span>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={config[f.key]}
                    onChange={(ev) =>
                      setConfigValue(f.key as keyof ObserverConfig, Number(ev.target.value))
                    }
                  />
                  <span className="tune-value mono">{fmt(config[f.key], f.unit)}</span>
                </label>
              ))}
            </div>
          ))}
        </section>
      </div>
    </aside>
  )
}

// useSyncExternalStore needs a stable primitive snapshot for the config store.
let version = 0
subscribeConfig(() => version++)
const configVersion = () => version
