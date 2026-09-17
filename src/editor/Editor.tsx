import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { programmaticEdit } from '../observer/annotations'
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
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px' },
            '.cm-scroller': {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              lineHeight: '1.6',
            },
            '&.cm-focused': { outline: 'none' },
          }),
          ...(extensions ?? []),
        ],
      }),
      parent: host.current,
    })

    viewRef.current = view
    onViewReady?.(view)

    return () => {
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
