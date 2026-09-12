import { useEffect, useRef, useState } from 'preact/hooks'

/**
 * The camera, opened inside the chat.
 *
 * A file input with `capture` cannot do what the instructions promise. On a
 * desktop browser the attribute is ignored outright and the rider gets a file
 * picker; on a phone it hands them out to the OS camera app and back. The
 * recorded line says "neeche button dabayen — camera khud khul jayega", so the
 * camera has to open here, in the conversation.
 *
 * If the browser refuses — no camera, no permission, an insecure origin — the
 * caller falls back to the file picker, which is why `onUnavailable` exists.
 */
export type Shot = { blob: Blob; url: string }

export function Camera({
  facing,
  label,
  onShot,
  onCancel,
  onUnavailable,
}: {
  facing: 'user' | 'environment'
  label: string
  onShot: (shot: Shot) => void
  onCancel: () => void
  onUnavailable: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * Held in a ref, not read from props inside the effect. The caller passes an
   * inline arrow, which is a new function on every render — as an effect
   * dependency that tore the stream down and rebuilt it each time, so the
   * preview never got as far as having dimensions and the shutter stayed dead.
   */
  const bail = useRef(onUnavailable)
  bail.current = onUnavailable

  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const got = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1600 }, height: { ideal: 1200 } },
          audio: false,
        })
        if (dead) {
          got.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = got
        const el = video.current
        if (!el) return
        el.srcObject = got
        await el.play().catch(() => {})
        // videoWidth is 0 until the metadata lands, and a shot taken before
        // then is a blank frame. Wait for the real thing.
        if (el.videoWidth) setReady(true)
        else el.addEventListener('loadedmetadata', () => setReady(true), { once: true })

        // A stream that never reports its size is a preview the rider can look
        // at but not use. Rather than leave them with a dead shutter, hand them
        // back to the picker, which always works.
        setTimeout(() => {
          if (!dead && !video.current?.videoWidth) bail.current()
        }, 6000)
      } catch {
        if (!dead) bail.current()
      }
    })()
    return () => {
      dead = true
      // Stop every track, or the browser keeps showing its recording light.
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [facing])

  const shoot = () => {
    const el = video.current
    if (!el || busy) return
    setBusy(true)
    const w = el.videoWidth || 1280
    const h = el.videoHeight || 960
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) {
      setBusy(false)
      return
    }
    // The preview is mirrored so it behaves like a mirror; the photograph must
    // not be, or the CNIC's face match is handed a flipped face.
    g.drawImage(el, 0, 0, w, h)
    canvas.toBlob(
      (blob) => {
        setBusy(false)
        if (blob) onShot({ blob, url: URL.createObjectURL(blob) })
      },
      'image/jpeg',
      0.9,
    )
  }

  return (
    <div class="camera" role="dialog" aria-label={label}>
      <div class="camera-stage">
        <video
          ref={video}
          class={facing === 'user' ? 'mirror' : ''}
          playsinline
          muted
          autoplay
        />
        {!ready && <span class="camera-wait">Camera khul raha hai…</span>}
      </div>
      <div class="camera-bar">
        <button class="camera-cancel" onClick={onCancel} aria-label="Band karein">
          ✕
        </button>
        <button
          class="shutter"
          onClick={shoot}
          disabled={!ready || busy}
          aria-label="Tasveer khenchein"
        >
          <span />
        </button>
        <span class="camera-spacer" />
      </div>
    </div>
  )
}
