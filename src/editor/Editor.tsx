import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { programmaticEdit } from '../observer/annotations'
import { editorTheme } from './theme'
import { basicSetup } from 'codemirror'
import { python } from '@codemirror/lang-python'
import { indentWithTab } from '@codemirror/commands'

type Props = {
  initialDoc: string
  /** Changing this replaces the document (used when switching exercises). */
  docKey?: string
  extensions?: Extension[]
  onRunShortcut?: () => void
  onViewReady?: (view: EditorView) => void
  readOnly?: boolean
}

export function Editor({
  initialDoc,
  docKey,
  extensions,
  onRunShortcut,
  onViewReady,
  readOnly = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Kept in a ref so the keymap closure never goes stale.
  const runRef = useRef(onRunShortcut)
  runRef.current = onRunShortcut

  useEffect(() => {
    if (!host.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          basicSetup,
          python(),
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: () => {
                runRef.current?.()
                return true
              },
            },
          ]),
          editorTheme,
          ...(extensions ?? []),
        ],
      }),
      parent: host.current,
    })

    viewRef.current = view
    onViewReady?.(view)

    // The teacher's bubble sizes itself against the editor it is in, which the
    // learner can now drag narrower than any window-based rule could know.
    // The width decides how the bubble wraps, so a new width changes the
    // bubble's height — and CodeMirror has to re-read it, or every line number
    // below the bubble drifts away from the code it labels. CodeMirror ignores
    // resizes within 75ms of an update (exactly when the bubble and the example
    // pane arrive together) and has no public "a widget's height changed" call;
    // the flag below is the one its own font-load handler sets. If a later
    // CodeMirror drops it, the only loss is that drift.
    let lastWidth = -1
    const setWidth = () => {
      const w = view.dom.clientWidth
      if (w === lastWidth) return
      lastWidth = w
      view.dom.style.setProperty('--editor-w', `${w}px`)
      const vs = (view as unknown as { viewState?: { mustMeasureContent?: unknown } }).viewState
      if (vs) vs.mustMeasureContent = true
      view.requestMeasure()
    }
    setWidth()
    const resize = new ResizeObserver(setWidth)
    resize.observe(view.dom)

    return () => {
      resize.disconnect()
      view.destroy()
      viewRef.current = null
    }
    // Extensions are static per mount by design; re-mounting on change would
    // destroy the learner's buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the document wholesale when the exercise changes.
  const lastKey = useRef(docKey)
  useEffect(() => {
    const view = viewRef.current
    if (!view || docKey === lastKey.current) return
    lastKey.current = docKey
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialDoc },
      annotations: programmaticEdit.of(true),
    })
  }, [docKey, initialDoc])

  return <div className="editor-host" ref={host} />
}
