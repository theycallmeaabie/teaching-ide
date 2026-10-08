import { useCallback, useRef, useState } from 'react'
import { readPref, writePref } from './prefs'

const KEY = 'teaching-ide:layout'

/** A null size means "use the default", so a reset really is a reset and the
 *  defaults can still depend on what is on screen (the example pane). */
export type Layout = {
  /** Width of the code area (editor + example + dock), % of the workspace. */
  codeW: number | null
  /** Width of the editor, % of the code row. Only meaningful beside the example pane. */
  editorW: number | null
  /** Height of the conversation dock while it is open, px. */
  dockH: number | null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function load(): Layout {
  try {
    const raw = readPref(KEY)
    const o = raw ? JSON.parse(raw) : {}
    return { codeW: num(o.codeW), editorW: num(o.editorW), dockH: num(o.dockH) }
  } catch {
    return { codeW: null, editorW: null, dockH: null }
  }
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load)
  // Mirrors state synchronously, so a commit at the end of a drag never saves
  // a size from a frame ago.
  const latest = useRef(layout)

  const set = useCallback((patch: Partial<Layout>) => {
    latest.current = { ...latest.current, ...patch }
    setLayout(latest.current)
  }, [])

  const commit = useCallback(() => writePref(KEY, JSON.stringify(latest.current)), [])

  return { layout, set, commit }
}
