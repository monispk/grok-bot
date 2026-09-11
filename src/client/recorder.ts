import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

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

export function supportsRecording(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

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

export type RecorderState = 'idle' | 'recording'

/**
 * Hold-to-talk without the holding: one tap starts, another sends. A long
 * recording stops itself, because a rider who forgets is otherwise uploading
 * minutes of silence over a slow connection.
 */
export function useRecorder(
  onDone: (r: Recording) => void,
  onDenied: () => void,
  maxSeconds = 90,
) {
  const [state, setState] = useState<RecorderState>('idle')
  const [seconds, setSeconds] = useState(0)

  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const cancelled = useRef(false)
  const startedAt = useRef(0)

  /** Releases the microphone, so the browser stops showing it as in use. */
  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    rec.current = null
    chunks.current = []
    setState('idle')
    setSeconds(0)
  }, [])

  useEffect(() => release, [release])

  const start = useCallback(async () => {
    if (!supportsRecording()) return onDenied()
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      stream.current = s
      cancelled.current = false
      chunks.current = []

      const mime = pickMime()
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
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
      setState('recording')
      setSeconds(0)
    } catch {
      // Denied, dismissed, or no microphone at all.
      release()
      onDenied()
    }
  }, [onDone, onDenied, release])

  const stop = useCallback(() => {
    cancelled.current = false
    if (rec.current?.state === 'recording') rec.current.stop()
    else release()
  }, [release])

  const cancel = useCallback(() => {
    cancelled.current = true
    if (rec.current?.state === 'recording') rec.current.stop()
    else release()
  }, [release])

  // Tick the timer, and stop a recording that has run away.
  useEffect(() => {
    if (state !== 'recording') return
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(elapsed)
      if (elapsed >= maxSeconds) stop()
    }, 250)
    return () => clearInterval(id)
  }, [state, maxSeconds, stop])

  return { state, seconds, start, stop, cancel }
}
