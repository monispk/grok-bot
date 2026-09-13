import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { browserSupport, classifyMicFailure, type MicFailure, type Support } from './device.ts'

export type Recording = { blob: Blob; mime: string; seconds: number }

/**
 * Containers MediaRecorder actually produces, best first. Chrome and Android
 * give webm/opus; Safari and iOS give mp4. Whisper accepts all of these, so the
 * recording is sent as-is rather than transcoded in the browser.
 */
const PREFERRED = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

/**
 * Speech needs far less than the default. At 32 kbit/s a thirty-second answer
 * is about 120 KB, which on the 3G most riders are on is the difference between
 * a reply in a few seconds and one they give up waiting for.
 */
const BITRATE = 32_000

/** A press shorter than this was a tap, and a tap gets the hint, not a clip. */
const MIN_HOLD_MS = 600

export const caps = () => ({
  mediaDevices: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  recorder: typeof MediaRecorder !== 'undefined',
})

export const support = (): Support =>
  browserSupport(typeof navigator === 'undefined' ? '' : navigator.userAgent, caps())

function pickMime(): string {
  for (const m of PREFERRED) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* older browsers throw rather than answer */
    }
  }
  return ''
}

export type PermissionKnown = 'granted' | 'denied' | 'prompt' | 'unknown'

/**
 * What the browser already knows about the microphone, without asking.
 *
 * Asking is what the old code did on every tap, and a browser that has been
 * told "block" answers a fresh request by refusing without a prompt — so each
 * tap produced the same refusal and the same message, which the rider read as
 * the app being stuck. Knowing the answer is "denied" beforehand means the
 * sheet can explain the way out instead.
 *
 * Firefox and Safari do not know this name and throw; that is 'unknown', and
 * the request is simply made.
 */
export async function permissionState(): Promise<PermissionKnown> {
  try {
    const s = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return s.state
  } catch {
    return 'unknown'
  }
}

/**
 * Fires when the permission changes underneath the page — the rider went into
 * site settings, allowed the microphone, and came back. The sheet listening to
 * this closes itself, so nobody has to know that a retry button exists.
 */
export function watchPermission(onChange: (state: PermissionKnown) => void): () => void {
  let status: PermissionStatus | null = null
  const handler = () => onChange(status?.state ?? 'unknown')
  navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then((s) => {
      status = s
      s.addEventListener('change', handler)
    })
    .catch(() => {})
  return () => status?.removeEventListener('change', handler)
}

const ASKED = 'grok-bot:mic-asked'
const askedBefore = () => {
  try {
    return localStorage.getItem(ASKED) === '1'
  } catch {
    return false
  }
}
const markAsked = () => {
  try {
    localStorage.setItem(ASKED, '1')
  } catch {
    /* private mode; the sheet shows once more, which is fine */
  }
}

export type RecorderState = 'idle' | 'asking' | 'recording' | 'locked'
export type MicProblem = 'unsupported' | 'ask' | MicFailure

/**
 * Hold to talk, the way WhatsApp does it.
 *
 * Press starts, release sends. A slide to the left cancels; a slide upwards
 * locks, and a locked recording carries on hands-free until the rider taps send
 * or the bin. A press too short to have been deliberate is a tap, and a tap
 * shows the hint rather than sending half a syllable.
 *
 * The gesture itself lives in mic.tsx. This is the microphone: permission,
 * stream, encoder, timer — and every way those can fail, named, so the sheet
 * can say something true about each.
 */
export function useRecorder({
  onDone,
  onProblem,
  onHint,
  maxSeconds = 90,
}: {
  onDone: (r: Recording) => void
  onProblem: (p: MicProblem) => void
  onHint: () => void
  maxSeconds?: number
}) {
  const [state, setState] = useState<RecorderState>('idle')
  const [seconds, setSeconds] = useState(0)

  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const cancelled = useRef(false)
  const startedAt = useRef(0)
  /** Whether the finger is still down. Read after every await. */
  const held = useRef(false)
  const stateRef = useRef<RecorderState>('idle')
  const go = (s: RecorderState) => {
    stateRef.current = s
    setState(s)
  }

  /** Releases the microphone, so the browser stops showing it as in use. */
  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    rec.current = null
    chunks.current = []
    go('idle')
    setSeconds(0)
  }, [])

  useEffect(() => release, [release])

  const acquire = useCallback(async (): Promise<MediaStream | MicFailure> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch (err) {
      return classifyMicFailure(err)
    }
  }, [])

  const press = useCallback(async () => {
    // Read into a local: narrowing the ref's property here would have the
    // compiler believe it is still 'idle' after go() has changed it.
    const before: RecorderState = stateRef.current
    if (before !== 'idle') return
    const s = support()
    if (!s.ok) return onProblem('unsupported')

    held.current = true
    go('asking')

    const known = await permissionState()
    if (known === 'denied') {
      go('idle')
      return onProblem('blocked')
    }
    if (known === 'prompt' && !askedBefore()) {
      // First time. The browser's prompt lands better after a word of warning,
      // and a rider mid-press cannot hold and answer a dialog at once.
      go('idle')
      return onProblem('ask')
    }

    const got = await acquire()
    if (typeof got === 'string') {
      go('idle')
      return onProblem(got)
    }
    markAsked()

    if (!held.current || stateRef.current !== 'asking') {
      // Let go while the prompt was up, or while a slow phone got the stream
      // together. Nothing was said, so nothing is sent; the hint explains.
      got.getTracks().forEach((t) => t.stop())
      go('idle')
      return onHint()
    }

    stream.current = got
    cancelled.current = false
    chunks.current = []
    const mime = pickMime()
    const r = new MediaRecorder(got, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: BITRATE,
    })
    rec.current = r
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data)
    }
    r.onstop = () => {
      const type = r.mimeType || mime || 'audio/webm'
      const blob = new Blob(chunks.current, { type })
      const elapsed = (Date.now() - startedAt.current) / 1000
      const send = !cancelled.current && blob.size > 0
      release()
      if (send) onDone({ blob, mime: type, seconds: elapsed })
    }
    startedAt.current = Date.now()
    r.start()
    setSeconds(0)
    go('recording')
  }, [acquire, onDone, onHint, onProblem, release])

  const finish = useCallback(
    (keep: boolean) => {
      cancelled.current = !keep
      if (rec.current?.state === 'recording') rec.current.stop()
      else release()
    },
    [release],
  )

  /** The finger came up. Only a held recording cares; a locked one ignores it. */
  const letGo = useCallback(() => {
    held.current = false
    if (stateRef.current !== 'recording') return
    if (Date.now() - startedAt.current < MIN_HOLD_MS) {
      finish(false)
      onHint()
    } else finish(true)
  }, [finish, onHint])

  const lock = useCallback(() => {
    if (stateRef.current === 'recording') go('locked')
  }, [])
  const cancel = useCallback(() => finish(false), [finish])
  const send = useCallback(() => finish(true), [finish])

  /**
   * Ask for the microphone from a tap on the sheet's own button, then let it go
   * again. What is wanted is the permission, not the stream; the stream comes
   * with the next press, which will not be prompted.
   */
  const allow = useCallback(async (): Promise<'granted' | MicFailure> => {
    markAsked()
    const got = await acquire()
    if (typeof got === 'string') return got
    got.getTracks().forEach((t) => t.stop())
    return 'granted'
  }, [acquire])

  // Tick the timer, and stop a recording that has run away.
  useEffect(() => {
    if (state !== 'recording' && state !== 'locked') return
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(elapsed)
      if (elapsed >= maxSeconds) finish(true)
    }, 250)
    return () => clearInterval(id)
  }, [state, maxSeconds, finish])

  // The screen went off, or the rider switched to a call. A browser tab in the
  // background is not guaranteed to keep the microphone, so what has been said
  // so far is sent rather than lost.
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === 'hidden' && rec.current?.state === 'recording')
        finish(Date.now() - startedAt.current >= MIN_HOLD_MS)
    }
    document.addEventListener('visibilitychange', away)
    return () => document.removeEventListener('visibilitychange', away)
  }, [finish])

  return { state, seconds, press, letGo, lock, cancel, send, allow }
}
