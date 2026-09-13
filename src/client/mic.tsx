import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { useRecorder } from './recorder.ts'

/**
 * How far the finger has to travel. Measured against WhatsApp on a 360px-wide
 * phone, which is what a fifth of riders in Pakistan hold: about a third of the
 * screen to the left cancels, and a thumb's length upwards locks.
 */
export const CANCEL_PX = 110
export const LOCK_PX = 70

const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not on this phone */
  }
}

/**
 * The hold-to-talk gesture, as pointer events on the microphone button.
 *
 * Pointer capture keeps the moves and the release coming to the button after
 * the finger has slid off it, which every cancel and every lock does. The
 * button carries `touch-action: none` so the page does not scroll instead, and
 * the context menu is swallowed because on Android a long press is a long press
 * before it is anything else.
 */
export function useMicGesture(rec: ReturnType<typeof useRecorder>) {
  const origin = useRef<{ x: number; y: number; id: number } | null>(null)
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  /** True for a moment after the slide up took, so the lock can be seen to shut. */
  const [justLocked, setJustLocked] = useState(false)
  /**
   * When the lock took. The send button appears where the microphone was,
   * under a finger that is still down — and the finger lifting is a click.
   * A send within half a second of locking is that, not a decision.
   */
  const lockedAt = useRef(0)
  useEffect(() => {
    if (!justLocked) return
    const t = setTimeout(() => setJustLocked(false), 900)
    return () => clearTimeout(t)
  }, [justLocked])

  const reset = () => {
    origin.current = null
    setDx(0)
    setDy(0)
  }

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* a browser without capture still gets moves while the finger is on it */
      }
      origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
      setDx(0)
      setDy(0)
      // The short buzz WhatsApp gives when the hold takes.
      if (rec.state === 'idle') buzz(20)
      void rec.press()
    },
    [rec],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const o = origin.current
      if (!o || e.pointerId !== o.id) return
      const x = Math.min(0, e.clientX - o.x)
      const y = Math.min(0, e.clientY - o.y)
      if (rec.state !== 'recording') return
      if (x < -CANCEL_PX) {
        rec.cancel()
        reset()
        return
      }
      if (y < -LOCK_PX) {
        rec.lock()
        // Felt as well as seen. WhatsApp buzzes here, and riders expect it.
        buzz(40)
        lockedAt.current = Date.now()
        setJustLocked(true)
        reset()
        return
      }
      setDx(x)
      setDy(y)
    },
    [rec],
  )

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const o = origin.current
      if (!o || e.pointerId !== o.id) return
      reset()
      rec.letGo()
    },
    [rec],
  )

  return {
    dx,
    dy,
    /** How far up the finger has come towards the lock, 0 to 1. */
    rise: Math.min(1, -dy / LOCK_PX),
    justLocked,
    /** Whether a tap on send right now is the lifting finger, not a choice. */
    settling: () => Date.now() - lockedAt.current < 500,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onContextMenu: (e: Event) => e.preventDefault(),
    },
  }
}
