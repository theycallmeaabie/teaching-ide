import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore, type Interaction } from '../store'

/**
 * The conversation on this exercise, as the teacher sees it.
 *
 * The inline bubble shows what is being said now; this is what has been said.
 * It is the teacher's memory made visible: if it asks "did the colon help?",
 * this is where the colon came up. Collapsed until there is something to
 * read, and it opens by itself when the learner speaks, since someone who has
 * just asked a question wants to see it kept.
 */

// Drawn rather than imported: the app makes no requests off-site, and these two
// glyphs are only used here.
function Glyph({ size = 14, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}
const ChatGlyph = () => (
  <Glyph>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.7A8 8 0 1 1 21 12Z" />
  </Glyph>
)
const ChevronGlyph = () => (
  <Glyph>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
)
const TeacherGlyph = () => (
  <Glyph size={15}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z" />
  </Glyph>
)
const LearnerGlyph = () => (
  <Glyph size={15}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Glyph>
)

/** What the teacher was doing when it said this, for the small label on it.
 *  Null for the learner, and for turns saved before the kind was recorded. */
function chipFor(t: Interaction): { kind: string; text: string } | null {
  if (t.role !== 'teacher' || !t.kind) return null
  switch (t.kind) {
    case 'hint':
      return { kind: 'hint', text: t.tier ? `Hint · tier ${t.tier}` : 'Hint' }
    case 'explain':
      return { kind: 'explain', text: 'Explanation' }
    case 'question':
      return { kind: 'question', text: 'Question' }
    case 'success':
      return { kind: 'success', text: 'That worked' }
    case 'error':
      return { kind: 'error', text: 'Error, explained' }
  }
}

/** Hints are written with `backticks` around code, and nothing else is markup. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export function Conversation() {
  const recent = useStore((s) => s.recent)
  const thinking = useStore((s) => s.teacherBusy)
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
  }, [open, recent.length, thinking])

  if (recent.length === 0) return null

  return (
    <div className="convo">
      <button className="convo-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="convo-badge">
          <ChatGlyph />
        </span>
        <span className="convo-title">Conversation</span>
        <span className="convo-count">{recent.length}</span>
        {thinking && (
          <span className="convo-live">
            <span className="convo-pulse" />
            thinking
          </span>
        )}
        <span className="convo-caret">
          <ChevronGlyph />
        </span>
      </button>
      {open && (
        <div className="convo-body" role="log" aria-live="polite">
          {recent.map((t, i) => {
            const chip = chipFor(t)
            return (
              <div
                key={i}
                className={`convo-turn convo-${t.role}${t.kind ? ` convo-k-${t.kind}` : ''}`}
                // A short cascade when the panel opens, capped so a long
                // conversation does not make anyone wait for it.
                style={{ '--i': Math.min(i, 8) } as CSSProperties}
              >
                <span className="convo-avatar">{t.role === 'teacher' ? <TeacherGlyph /> : <LearnerGlyph />}</span>
                <div className="convo-msg">
                  <div className="convo-meta">
                    <span className="convo-who">{t.role === 'teacher' ? 'Teacher' : 'You'}</span>
                    {chip && <span className={`convo-chip convo-chip-${chip.kind}`}>{chip.text}</span>}
                  </div>
                  <div className="convo-text">
                    <Prose text={t.text} />
                  </div>
                </div>
              </div>
            )
          })}
          {thinking && (
            <div className="convo-typing" aria-hidden="true">
              <span className="convo-avatar">
                <TeacherGlyph />
              </span>
              <span className="convo-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  )
}
