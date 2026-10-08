import { useState } from 'react'
import { askTeacherQuestion } from '../lesson/teaching'
import { useStore } from '../store'
import { ArrowUpRightIcon, MicIcon } from './icons'

/** Learner-initiated questions reset the cooldown and cost no interruption
 *  budget — asking is always free. */
export function AskBox() {
  const [text, setText] = useState('')
  const busy = useStore((s) => s.teacherBusy)

  const send = () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    void askTeacherQuestion(t)
  }

  return (
    <div className="askbox">
      <div className="askfield">
        <input
          value={text}
          placeholder="Ask about anything — this never counts against you"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
            e.stopPropagation()
          }}
        />
        {/* Placeholder: voice questions are not wired up yet. */}
        <button
          className="btn btn-ghost btn-icon"
          disabled
          title="Ask by voice — coming soon"
          aria-label="Ask by voice (coming soon)"
        >
          <MicIcon size={18} />
        </button>
        <button className="btn btn-ask" onClick={send} disabled={busy || !text.trim()}>
          {busy ? 'thinking…' : 'Ask'}
          {!busy && <ArrowUpRightIcon size={13} />}
        </button>
      </div>
    </div>
  )
}
