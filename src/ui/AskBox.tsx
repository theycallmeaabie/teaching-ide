import { useRef, useState } from 'react'
import { askTeacherQuestion } from '../lesson/teaching'
import { useStore } from '../store'
import { ArrowUpRightIcon, MicIcon, StopIcon } from './icons'
import { useVoice, voiceSupport } from './useVoice'

const PLACEHOLDER = 'Ask about anything'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Learner-initiated questions reset the cooldown and cost no interruption
 *  budget: asking is always free. */
export function AskBox() {
  const [text, setText] = useState('')
  const busy = useStore((s) => s.teacherBusy)
  const input = useRef<HTMLInputElement>(null)
  const support = voiceSupport()

  // What was said goes into the box, never straight to the teacher: the learner
  // reads it (and fixes "Colin" back to "colon") and presses Ask themselves.
  const voice = useVoice((spoken) => {
    setText((t) => (t.trim() ? `${t.trimEnd()} ${spoken}` : spoken))
    requestAnimationFrame(() => {
      const el = input.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  })

  const send = () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    void askTeacherQuestion(t)
  }

  const recording = voice.state === 'recording'
  const working = voice.state === 'starting' || voice.state === 'transcribing'
  const placeholder = recording
    ? `Listening… ${clock(voice.seconds)}. Click the mic when you're done (Esc cancels)`
    : voice.state === 'transcribing'
      ? 'Turning that into words…'
      : PLACEHOLDER
  const micTitle = !support.ok
    ? support.why
    : recording
      ? 'Stop and turn it into text (Esc cancels)'
      : 'Ask by voice'

  return (
    <div className="askbox">
      {voice.error && (
        <div className="ask-note" role="status">
          {voice.error}
        </div>
      )}
      <div className="askfield">
        <input
          ref={input}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
            e.stopPropagation()
          }}
        />
        <button
          className={`btn btn-ghost btn-icon ${recording ? 'mic-rec' : ''}`}
          onClick={recording ? voice.stop : voice.start}
          disabled={!support.ok || working}
          aria-pressed={recording}
          aria-label={recording ? 'Stop recording' : 'Ask by voice'}
          title={micTitle}
        >
          {working ? <span className="spinner" /> : recording ? <StopIcon size={16} /> : <MicIcon size={18} />}
        </button>
        <button className="btn btn-ask" onClick={send} disabled={busy || !text.trim()}>
          {busy ? 'thinking…' : 'Ask'}
          {!busy && <ArrowUpRightIcon size={13} />}
        </button>
      </div>
      {/* Screen readers get the state changes the visual cues carry. */}
      <span className="sr-only" role="status" aria-live="polite">
        {recording ? 'Recording' : voice.state === 'transcribing' ? 'Transcribing' : ''}
      </span>
    </div>
  )
}
