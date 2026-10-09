import { useSyncExternalStore } from 'react'
import { setVoiceOn, subscribeVoice, voiceOn, voiceSupported } from '../teacher/voice'
import { SpeakerIcon, SpeakerOffIcon } from './icons'

/** Whether the teacher's words are read aloud. Off until chosen, then remembered. */
export function VoiceToggle() {
  const on = useSyncExternalStore(subscribeVoice, voiceOn)
  const supported = voiceSupported()

  return (
    <button
      className="btn btn-ghost btn-icon voice-toggle"
      onClick={() => setVoiceOn(!on)}
      disabled={!supported}
      aria-pressed={on}
      title={!supported ? "This browser can't read aloud" : on ? 'Stop reading the teacher aloud' : 'Read the teacher aloud'}
    >
      {on ? <SpeakerIcon size={22} /> : <SpeakerOffIcon size={22} />}
      <span className="sr-only">{on ? 'Voice on' : 'Voice off'}</span>
    </button>
  )
}
