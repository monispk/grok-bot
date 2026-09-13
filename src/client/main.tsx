import { render } from 'preact'
import { App } from './app.tsx'
import { chromeHandoff } from './device.ts'
import { caps } from './recorder.ts'
import './styles.css'

/**
 * Before anything is drawn: a browser that cannot do what this app needs
 * hands the visit to Chrome, if the phone has it. The decision is in
 * device.ts; what is recorded here is the attempt, so that a phone without
 * Chrome — which comes straight back to this page — does not go round again,
 * and so a test can see what was tried.
 */
const TRIED = 'grok-bot:chrome-tried'
const read = (get: () => string | null) => {
  try {
    return get()
  } catch {
    return null
  }
}
const answered = (() => {
  try {
    const h = JSON.parse(read(() => localStorage.getItem('grok-bot:history')) ?? '[]')
    return Array.isArray(h) && h.some((m) => m?.role === 'user')
  } catch {
    return false
  }
})()
const handoff = chromeHandoff({
  ua: navigator.userAgent,
  caps: caps(),
  href: location.href,
  answered,
  tried: !!read(() => sessionStorage.getItem(TRIED)),
})
if (handoff) {
  try {
    sessionStorage.setItem(TRIED, handoff)
  } catch {
    /* no storage; the ?chrome=no mark still stops a second attempt */
  }
  location.replace(handoff)
}

// Drawn regardless. A browser that blocks the hand-off, or one that shows
// Chrome beside itself, leaves the rider looking at this page.
render(<App />, document.getElementById('app')!)
