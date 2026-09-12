/**
 * Plays the bot's voice notes aloud as they arrive, in the order they were
 * said.
 *
 * Arrival order is not thread order, which is the whole difficulty. A step's
 * question has a recording sitting on disk and is ready at once; an answer the
 * model just wrote has to be sent to Uplift and read, which takes a second or
 * two. Queue them as they turn up and the rider hears the next question before
 * the answer to the one they asked. So the thread decides the order, and a clip
 * still being made holds its place — the queue waits for it rather than
 * stepping over it.
 *
 * Two more things to respect. A browser refuses sound until the page has been
 * touched, so a blocked clip is put back and the queue starts at the rider's
 * first tap. And if the rider presses play on something themselves, that is an
 * instruction: the queue gets out of the way.
 */
const GAP_MS = 2000
/** How long to hold the queue for a clip that may never arrive. */
const PATIENCE_MS = 20_000

let order: string[] = []
const players = new Map<string, HTMLAudioElement>()
const finished = new Set<string>()

let current: HTMLAudioElement | null = null
let lastEnded = 0
let gapTimer: ReturnType<typeof setTimeout> | null = null
let waitTimer: ReturnType<typeof setTimeout> | null = null
let waitingFor: string | null = null
let blocked = false

function clearTimers() {
  if (gapTimer) clearTimeout(gapTimer)
  if (waitTimer) clearTimeout(waitTimer)
  gapTimer = waitTimer = null
  waitingFor = null
}

function pump() {
  if (current || blocked || gapTimer) return

  const next = order.find((id) => !finished.has(id))
  if (!next) {
    if (waitTimer) clearTimeout(waitTimer)
    waitTimer = null
    waitingFor = null
    return
  }

  const el = players.get(next)
  if (!el) {
    // Still being read. Hold the rider's place, but not forever: if it never
    // comes, the conversation has to keep moving.
    if (waitingFor === next) return
    if (waitTimer) clearTimeout(waitTimer)
    waitingFor = next
    waitTimer = setTimeout(() => {
      waitTimer = null
      waitingFor = null
      finished.add(next)
      pump()
    }, PATIENCE_MS)
    return
  }

  if (waitTimer) clearTimeout(waitTimer)
  waitTimer = null
  waitingFor = null

  const wait = Math.max(0, GAP_MS - (Date.now() - lastEnded))
  gapTimer = setTimeout(() => {
    gapTimer = null
    const done = () => {
      el.removeEventListener('ended', done)
      el.removeEventListener('error', done)
      if (current === el) current = null
      finished.add(next)
      lastEnded = Date.now()
      pump()
    }
    el.addEventListener('ended', done)
    el.addEventListener('error', done)

    current = el
    void el.play().catch(() => {
      el.removeEventListener('ended', done)
      el.removeEventListener('error', done)
      current = null
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

/** The bot's voice notes, in the order the thread says them. */
export function setOrder(ids: string[]) {
  order = ids
  pump()
}

/** A voice note's player now exists and can be heard. */
export function register(id: string, el: HTMLAudioElement) {
  if (players.get(id) === el) return
  players.set(id, el)
  pump()
}

/** The rider pressed play themselves. Their choice wins; the queue stands down. */
export function takeOver(el: HTMLAudioElement) {
  clearTimers()
  order = []
  if (current && current !== el) current.pause()
  current = null
}

/** Clear: nothing queued should outlive the conversation it belonged to. */
export function stopAll() {
  clearTimers()
  order = []
  players.clear()
  finished.clear()
  if (current) current.pause()
  current = null
  lastEnded = 0
  blocked = false
}
