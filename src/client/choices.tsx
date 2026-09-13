/**
 * Two pictures to tap instead of typing "haan" or "nahi": a bike with a tick,
 * a bike crossed out; the same for a phone. For a rider who reads slowly a
 * picture is the quickest answer there is, and it cannot be misspelled.
 *
 * Tapping one is exactly a typed answer — the same words go down the same
 * path — with the picture kept in the thread so it is plain which was chosen.
 */
export type Choice = { answer: 'haan' | 'nahi'; label: string; src: string }

export const CHOICES: Record<string, Choice[]> = {
  smartphone: [
    { answer: 'haan', label: 'Haan, touch phone hai', src: '/choice-phone-yes.jpg' },
    { answer: 'nahi', label: 'Nahi, touch phone nahi hai', src: '/choice-phone-no.jpg' },
  ],
  bike: [
    { answer: 'haan', label: 'Haan, bike hai', src: '/choice-bike-yes.jpg' },
    { answer: 'nahi', label: 'Nahi, bike nahi hai', src: '/choice-bike-no.jpg' },
  ],
}

/**
 * A short, bright tap sound, made on the spot. A file would need loading
 * before the first tap on a slow connection; two oscillators need nothing.
 * Played from the tap itself, so no autoplay rule stands in its way.
 */
let ctx: AudioContext | null = null
export function blip() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    gain.connect(ctx.destination)
    for (const [freq, at] of [
      [880, 0],
      [1320, 0.07],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(freq, t + at)
      o.connect(gain)
      o.start(t + at)
      o.stop(t + 0.2)
    }
  } catch {
    /* no audio here; the picture in the thread still says what was chosen */
  }
  try {
    navigator.vibrate?.(15)
  } catch {
    /* not on this phone */
  }
}

export function Choices({
  options,
  disabled,
  onPick,
}: {
  options: Choice[]
  disabled: boolean
  onPick: (c: Choice) => void
}) {
  return (
    <div class="choices" role="group" aria-label="Jawab chunein">
      {options.map((c) => (
        <button
          key={c.src}
          class={`choice ${c.answer}`}
          disabled={disabled}
          onClick={() => {
            blip()
            onPick(c)
          }}
        >
          <img src={c.src} alt={c.label} draggable={false} />
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  )
}
