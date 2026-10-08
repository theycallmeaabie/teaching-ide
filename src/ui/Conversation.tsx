import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

/**
 * The conversation on this exercise, as the teacher sees it.
 *
 * The inline bubble shows what is being said now; this is what has been said.
 * It is the teacher's memory made visible — if it asks "did the colon help?",
 * this is where the colon came up. Collapsed until there is something to
 * read, and it opens by itself when the learner speaks, since someone who has
 * just asked a question wants to see it kept.
 */
export function Conversation() {
  const recent = useStore((s) => s.recent)
  const [open, setOpen] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  const learnerTurns = recent.filter((t) => t.role === 'learner').length
  const seenLearnerTurns = useRef(learnerTurns)

  useEffect(() => {
    if (learnerTurns > seenLearnerTurns.current) setOpen(true)
    seenLearnerTurns.current = learnerTurns
  }, [learnerTurns])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, recent.length])

  if (recent.length === 0) return null

  return (
    <div className="convo">
      <button className="convo-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Conversation</span>
        <span className="convo-count">{recent.length}</span>
        <span className="convo-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="convo-body" role="log" aria-live="polite">
          {recent.map((t, i) => (
            <div key={i} className={`convo-turn convo-${t.role}`}>
              <span className="convo-who">{t.role === 'teacher' ? 'Teacher' : 'You'}</span>
              <span className="convo-text">{t.text}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  )
}
