import { Editor } from '../editor/Editor'

/** Tier 4+ only. Read-only by construction — the learner's buffer is theirs. */
export function ScratchPane({ code }: { code: string }) {
  return (
    <div className="pane scratch-pane">
      <div className="pane-head">
        <span>example.py</span>
        <span className="muted">read-only — yours to copy, not to run</span>
      </div>
      <div className="pane-body pane-body-flush">
        <Editor initialDoc={code} docKey={code} readOnly />
      </div>
    </div>
  )
}
