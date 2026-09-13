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
/**
 * The silence between one voice note finishing and the next starting.
 *
 * A minimum, not a fixed delay: a clip still being synthesised plays the moment
 * it arrives rather than waiting a further pause on top. Exported so the
 * browser test measures against this number instead of its own copy of it.
 */
export const GAP_MS = 1000
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
/** A clip the rider started themselves. The queue holds off until it ends. */
let manual: HTMLAudioElement | null = null

function clearTimers() {
  if (gapTimer) clearTimeout(gapTimer)
  if (waitTimer) clearTimeout(waitTimer)
  gapTimer = waitTimer = null
  waitingFor = null
}

function pump() {
  if (current || blocked || gapTimer || manual) return

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
      // A browser fires 'play' and only then refuses, so the bubble is already
      // showing a pause button. Left alone it sits there at 0:00 looking as
      // though it is playing. Put it back to rest and tell the truth.
      el.pause()
      // Rewinding before the metadata has loaded throws in some browsers, and a
      // clip that stays put is a far smaller problem than one that crashes.
      try {
        el.currentTime = 0
      } catch {
        /* it will start from the beginning anyway */
      }
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

/**
 * Which voice notes can be heard right now — their player has enough of the
 * clip to start, or has given up trying. The thread's pacing waits on this:
 * the next thing said comes two seconds after the last voice note is *there*,
 * not two seconds after an empty bubble was put in its place. On a 3G phone
 * those are not the same moment.
 */
/**
 * Every player on screen, queued or not.
 *
 * `players` holds only the bot's clips, because only those have a place in the
 * queue. A rider's own recording has none — and pressing play on one used to
 * leave whatever was already playing running underneath it, because the code
 * that stops things only knew about the queue.
 */
const all = new Set<HTMLAudioElement>()

/** Called by every voice note on screen, for the lifetime of the bubble. */
export function watch(el: HTMLAudioElement): () => void {
  all.add(el)
  return () => {
    all.delete(el)
  }
}

/** Silences everything except the one clip that is about to be heard. */
function hushOthers(except: HTMLAudioElement | null) {
  for (const el of all) if (el !== except && !el.paused) el.pause()
}

const heard = new Set<string>()
const waiting = new Map<string, Set<() => void>>()

export function markReady(id: string) {
  if (heard.has(id)) return
  heard.add(id)
  waiting.get(id)?.forEach((cb) => cb())
  waiting.delete(id)
}

export const isReady = (id: string) => heard.has(id)

/** Calls back once the note can be heard; at once if it already can. */
export function whenReady(id: string, cb: () => void): () => void {
  if (heard.has(id)) {
    cb()
    return () => {}
  }
  const set = waiting.get(id) ?? new Set<() => void>()
  set.add(cb)
  waiting.set(id, set)
  return () => {
    set.delete(cb)
  }
}

/** A voice note's player now exists and can be heard. */
export function register(id: string, el: HTMLAudioElement) {
  if (players.get(id) === el) return
  players.set(id, el)
  pump()
}

/**
 * The rider pressed play themselves. Their choice wins: whatever the queue was
 * playing stops, it will not play that clip again on its own, and it stays out
 * of the way until theirs has finished. If they pause it and leave it, the
 * queue stays quiet — they stopped it on purpose.
 */
export function takeOver(el: HTMLAudioElement) {
  clearTimers()
  // Everything, not just the queue's clip: two voice notes playing over each
  // other is the one thing a rider cannot fix from the interface.
  hushOthers(el)
  current = null
  for (const [id, player] of players) if (player === el) finished.add(id)

  manual = el
  const over = () => {
    el.removeEventListener('ended', over)
    if (manual !== el) return
    manual = null
    lastEnded = Date.now()
    pump()
  }
  el.addEventListener('ended', over)
}

/** Clear: nothing queued should outlive the conversation it belonged to. */
export function stopAll() {
  clearTimers()
  order = []
  players.clear()
  finished.clear()
  hushOthers(null)
  current = null
  manual = null
  lastEnded = 0
  blocked = false
}
