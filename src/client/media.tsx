import { useMemo, useRef, useState } from 'preact/hooks'

const mmss = (s: number, roundUp = false) => {
  if (!Number.isFinite(s) || s < 0) s = 0
  const t = roundUp ? Math.ceil(s) : Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** WhatsApp-style voice note: play/pause, scrub bar, elapsed time. */
export function VoiceNote({ sources }: { sources: { src: string; type: string }[] }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [pos, setPos] = useState(0)
  const [attempt, setAttempt] = useState(0)

  /**
   * The source is chosen here and set as `src`, rather than listing <source>
   * children. A player created mid-conversation could fire `error` before its
   * children were attached, and the bubble removed itself over a file that was
   * perfectly fine — it then appeared correctly on the next page load, because
   * then the whole tree rendered at once.
   */
  const ordered = useMemo(() => {
    const probe = typeof Audio === 'undefined' ? null : new Audio()
    const playable = probe ? sources.filter((s) => probe.canPlayType(s.type)) : []
    return playable.length ? playable : sources
  }, [sources])

  // Only after every candidate has genuinely failed is the bubble dropped.
  const current = ordered[attempt]
  if (!current) return null

  const toggle = () => {
    const a = ref.current
    if (!a) return
    // A rejected play() is usually an autoplay policy, not a broken file, so it
    // must never remove the player.
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }

  return (
    <div class="voice">
      <button
        class="play"
        onClick={toggle}
        aria-label={playing ? 'Rok dein' : 'Awaaz sunein'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        )}
      </button>

      <input
        class="scrub"
        type="range"
        min="0"
        max={duration || 0}
        step="0.1"
        value={pos}
        aria-label="Awaaz ki position"
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value)
          if (ref.current) ref.current.currentTime = v
          setPos(v)
        }}
      />

      <span class="time">
        {pos > 0 || playing ? mmss(pos) : mmss(duration, true)}
      </span>

      <audio
        ref={ref}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        onTimeUpdate={(e) => setPos((e.target as HTMLAudioElement).currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPos(0)
        }}
        onError={() => setAttempt((a) => a + 1)}
        src={current.src}
      />
    </div>
  )
}

/** Image bubble that removes itself if the file cannot be loaded. */
export function Picture({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img class="photo" src={src} alt={alt} onError={() => setFailed(true)} />
}

const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

/** A document the rider sent: images preview, PDFs show as a card. */
export function DocumentBubble({
  src,
  name,
  mime,
  size,
}: {
  src: string
  name: string
  mime: string
  size: number
}) {
  const [failed, setFailed] = useState(false)

  if (mime.startsWith('image/') && !failed)
    return <img class="photo doc" src={src} alt={name} onError={() => setFailed(true)} />

  return (
    <a class="filecard" href={src} target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
      </svg>
      <span class="meta">
        <strong>{name}</strong>
        <small>{mime === 'application/pdf' ? 'PDF' : mime} · {kb(size)}</small>
      </span>
    </a>
  )
}
