import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

type Props = {
  /** 'col' is a vertical bar that resizes widths; 'row' is a horizontal bar that resizes heights. */
  orientation: 'col' | 'row'
  label: string
  /** The size being controlled, in px. Read when a drag starts. */
  getSize: () => number
  /** Smallest and largest allowed size in px. Read on every move, since they depend on the window. */
  bounds: () => [number, number]
  onSize: (px: number) => void
  /** 'backward' for a panel docked at the far end: dragging up/left makes it bigger. */
  grow?: 'forward' | 'backward'
  /** Drag or key press finished. The place to persist. */
  onCommit?: () => void
  /** Double-click or Enter: back to the default size. */
  onReset?: () => void
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v))

/** A draggable divider. Pointer-captured, so the drag survives crossing the
 *  editor, and keyboard-operable (arrow keys, Shift for bigger steps). */
export function Splitter({ orientation, label, getSize, bounds, onSize, grow = 'forward', onCommit, onReset }: Props) {
  const drag = useRef<{ start: number; size: number } | null>(null)
  const axis = (e: { clientX: number; clientY: number }) => (orientation === 'col' ? e.clientX : e.clientY)
  const sign = grow === 'backward' ? -1 : 1
  const bodyClass = `resizing-${orientation}`

  const finish = () => {
    if (!drag.current) return
    drag.current = null
    document.body.classList.remove(bodyClass)
    onCommit?.()
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { start: axis(e), size: getSize() }
    document.body.classList.add(bodyClass)
    e.preventDefault()
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    onSize(clamp(drag.current.size + (axis(e) - drag.current.start) * sign, bounds()))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      onReset?.()
      onCommit?.()
      return
    }
    const forward = orientation === 'col' ? 'ArrowRight' : 'ArrowDown'
    const back = orientation === 'col' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== forward && e.key !== back) return
    e.preventDefault()
    const step = (e.shiftKey ? 64 : 16) * (e.key === forward ? 1 : -1) * sign
    onSize(clamp(getSize() + step, bounds()))
    onCommit?.()
  }

  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation === 'col' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label}: drag, or double-click to reset`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onReset?.()
        onCommit?.()
      }}
    />
  )
}
