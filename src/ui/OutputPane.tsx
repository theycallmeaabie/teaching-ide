import type { RunResult } from '../types'

export function OutputPane({
  result,
  busy,
  errorPlain,
}: {
  result: RunResult | null
  busy: boolean
  /** Dictionary translation of the error. Not the teacher, not gated. */
  errorPlain?: string | null
}) {
  return (
    <div className="pane output-pane">
      <div className="pane-head">
        <span>Output</span>
        {result && (
          <span className="muted">{Math.round(result.durationMs)} ms</span>
        )}
      </div>
      <div className="pane-body">
        {busy && <div className="muted mono">running…</div>}
        {!busy && !result && (
          <div className="muted mono">Press Run to execute your code.</div>
        )}
        {result && (
          <>
            {result.stdout && <pre className="stdout">{result.stdout}</pre>}
            {result.error && (
              <pre className="err">
                <strong>{result.error.type}</strong>
                {result.error.line != null && ` on line ${result.error.line}`}
                {'\n'}
                {result.error.message}
              </pre>
            )}
            {result.error && errorPlain && (
              <p className="err-plain">{errorPlain}</p>
            )}
            {result.ok && !result.stdout && (
              <div className="muted mono">(ran with no output)</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
