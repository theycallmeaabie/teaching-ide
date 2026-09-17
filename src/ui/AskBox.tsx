import { useState } from 'react'
import { askTeacherQuestion } from '../lesson/teaching'
import { useStore } from '../store'

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
      <button className="btn btn-ghost small" onClick={send} disabled={busy || !text.trim()}>
        {busy ? 'thinking…' : 'Ask'}
      </button>
    </div>
  )
}
