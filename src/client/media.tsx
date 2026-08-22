import { useRef, useState } from 'preact/hooks'

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
  const [failed, setFailed] = useState(false)

  // If neither format can play, drop the bubble rather than show a dead control.
  if (failed) return null

  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) void a.play().catch(() => setFailed(true))
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
        onError={() => setFailed(true)}
      >
        {sources.map((s) => (
          <source key={s.src} src={s.src} type={s.type} />
        ))}
      </audio>
    </div>
  )
}

/** Image bubble that removes itself if the file cannot be loaded. */
export function Picture({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img class="photo" src={src} alt={alt} onError={() => setFailed(true)} />
}
