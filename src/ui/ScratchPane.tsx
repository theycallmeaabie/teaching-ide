import { useState } from 'react'
import { Editor } from '../editor/Editor'
import { BookIcon, CheckIcon, CopyIcon } from './icons'

/** Tier 4+ only. Read-only by construction — the learner's buffer is theirs. */
export function ScratchPane({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  // Copies to the clipboard only. The example is the learner's to paste, never
  // the teacher's to insert.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: nothing to do, the text is still selectable */
    }
  }

  return (
    <div className="pane scratch-pane">
      <div className="pane-head">
        <span className="pane-title">
          <BookIcon size={15} />
          example.py
          <span className="badge">read-only</span>
        </span>
        <span className="pane-end">
          <span className="muted">yours to copy, not to run</span>
          <button className="pane-tool" onClick={copy} title="Copy the example" aria-label="Copy the example">
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
        </span>
      </div>
      <div className="pane-body pane-body-flush">
        <Editor initialDoc={code} docKey={code} readOnly />
      </div>
    </div>
  )
}
