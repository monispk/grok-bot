/**
 * Plays the bot's voice notes aloud as they arrive, one at a time.
 *
 * A rider who cannot read well should not have to find and press play on every
 * bubble. But two clips talking over each other are worse than none, so they
 * queue: one plays, and the next waits for it to finish and then for a further
 * two seconds, which is about as long as a person leaves before speaking again.
 *
 * Two things this has to respect. A browser refuses to play sound until the page
 * has been touched, so a blocked clip is put back rather than dropped and the
 * queue starts at the rider's first tap. And if the rider presses play on
 * something themselves, that is an instruction: the queue gets out of the way.
 */
const GAP_MS = 2000

let queue: HTMLAudioElement[] = []
let current: HTMLAudioElement | null = null
let lastEnded = 0
let timer: ReturnType<typeof setTimeout> | null = null
let blocked = false

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

function pump() {
  if (current || blocked || timer) return
  if (!queue.length) return

  const wait = Math.max(0, GAP_MS - (Date.now() - lastEnded))
  timer = setTimeout(() => {
    timer = null
    const el = queue.shift()
    if (!el) return

    const finish = () => {
      el.removeEventListener('ended', finish)
      el.removeEventListener('error', finish)
      if (current === el) current = null
      lastEnded = Date.now()
      pump()
    }
    el.addEventListener('ended', finish)
    el.addEventListener('error', finish)

    current = el
    void el.play().catch(() => {
      // Sound is refused until the page has been touched. Put it back and wait
      // for the rider rather than losing the clip.
      el.removeEventListener('ended', finish)
      el.removeEventListener('error', finish)
      current = null
      queue.unshift(el)
      blocked = true
      waitForTouch()
    })
  }, wait)
}

function waitForTouch() {
  const go = () => {
    document.removeEventListener('pointerdown', go)
    document.removeEventListener('keydown', go)
    blocked = false
    // They have just acted; do not make them sit through the gap as well.
    lastEnded = 0
    pump()
  }
  document.addEventListener('pointerdown', go, { once: true })
  document.addEventListener('keydown', go, { once: true })
}

/** A voice note has landed and should be heard when its turn comes. */
export function enqueue(el: HTMLAudioElement) {
  if (queue.includes(el) || current === el) return
  queue.push(el)
  pump()
}

/** The rider pressed play themselves. Their choice wins; the queue stands down. */
export function takeOver(el: HTMLAudioElement) {
  clearTimer()
  queue = []
  if (current && current !== el) current.pause()
  current = null
}

/** Clear, or leaving the page: nothing queued should outlive the conversation. */
export function stopAll() {
  clearTimer()
  queue = []
  if (current) current.pause()
  current = null
  lastEnded = 0
  blocked = false
}
