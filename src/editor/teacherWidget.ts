import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import type { Speech } from '../store'

/** Pushes the current teacher speech into the editor. */
export const setSpeechEffect = StateEffect.define<Speech | null>()

let dismissHandler: (() => void) | null = null
export function setDismissHandler(fn: (() => void) | null) {
  dismissHandler = fn
}

const TIER_LABEL = ['', 'a nudge', 'the line', 'the concept', 'a worked example', 'walk it through']

const KIND_LABEL: Record<Speech['kind'], string> = {
  hint: 'hint',
  question: 'a question for you',
  explain: 'an explanation',
  error: 'what that error means',
  success: 'that worked',
}

/** Hint text is authored with `backticks` around code. Nothing else is markup. */
function renderProse(target: HTMLElement, text: string) {
  target.textContent = ''
  for (const part of text.split(/(`[^`]*`)/g)) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = document.createElement('code')
      code.textContent = part.slice(1, -1)
      target.appendChild(code)
    } else if (part) {
      target.appendChild(document.createTextNode(part))
    }
  }
}

class SpeechWidget extends WidgetType {
  constructor(readonly s: Speech) {
    super()
  }

  eq(other: SpeechWidget): boolean {
    return (
      other.s.id === this.s.id &&
      other.s.text === this.s.text &&
      other.s.streaming === this.s.streaming &&
      other.s.source === this.s.source
    )
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div')
    root.className = `cm-speech cm-speech-${this.s.kind}`
    root.dataset.speechId = String(this.s.id)

    const head = document.createElement('div')
    head.className = 'cm-speech-head'

    const label = document.createElement('span')
    label.className = 'cm-speech-label'
    head.appendChild(label)

    const src = document.createElement('span')
    src.className = 'cm-speech-src'
    head.appendChild(src)

    const x = document.createElement('button')
    x.className = 'cm-speech-x'
    x.type = 'button'
    x.title = 'dismiss'
    x.textContent = '×'
    x.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      dismissHandler?.()
    })
    head.appendChild(x)

    const body = document.createElement('div')
    body.className = 'cm-speech-text'

    root.appendChild(head)
    root.appendChild(body)
    this.paint(root)
    return root
  }

  /** Streaming updates patch the existing node — recreating it on every chunk
   *  would make the hint flicker as it arrives. */
  updateDOM(dom: HTMLElement): boolean {
    if (dom.dataset.speechId !== String(this.s.id)) return false
    this.paint(dom)
    return true
  }

  private paint(root: HTMLElement) {
    const label = root.querySelector('.cm-speech-label') as HTMLElement
    const src = root.querySelector('.cm-speech-src') as HTMLElement
    const body = root.querySelector('.cm-speech-text') as HTMLElement

    label.textContent =
      this.s.kind === 'hint' && this.s.tier
        ? `tier ${this.s.tier} · ${TIER_LABEL[this.s.tier]}`
        : KIND_LABEL[this.s.kind]
    src.textContent = this.s.source === 'prewritten' ? 'pre-written' : ''
    root.classList.toggle('streaming', this.s.streaming)
    renderProse(body, this.s.text)
    if (this.s.followup) {
      const q = document.createElement('div')
      q.className = 'cm-speech-followup'
      q.textContent = this.s.followup
      body.appendChild(q)
    }
  }

  ignoreEvent(): boolean {
    return true
  }
}

function build(state: { doc: { lines: number; line: (n: number) => { from: number; to: number } } }, s: Speech | null): DecorationSet {
  if (!s || !s.text) return Decoration.none
  const lines = state.doc.lines
  // No target line means "near where they are working" — the end of the buffer.
  const n = Math.min(Math.max(s.targetLine ?? lines, 1), lines)
  const line = state.doc.line(n)

  const ranges = []
  if (s.targetLine != null) {
    // Amber, never red: half of these are not errors.
    ranges.push(Decoration.line({ class: 'cm-target-line' }).range(line.from))
  }
  ranges.push(
    Decoration.widget({ widget: new SpeechWidget(s), side: 1, block: true }).range(line.to),
  )
  return Decoration.set(ranges, true)
}

const speechField = StateField.define<Speech | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSpeechEffect)) return e.value
    return value
  },
})

const speechDecorations = EditorView.decorations.compute([speechField, 'doc'], (state) =>
  build(state as never, state.field(speechField)),
)

export function teacherWidgetExtension() {
  return [speechField, speechDecorations]
}
