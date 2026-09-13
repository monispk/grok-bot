/**
 * What this phone and browser can actually do — decided once, from evidence,
 * rather than discovered by failing in front of the rider.
 *
 * Pure functions, so they can be tested under node against real user agent
 * strings. Everything that touches `navigator` is in recorder.ts.
 */

export type Support =
  | { ok: true }
  | { ok: false; why: 'opera-mini' | 'uc' | 'in-app' | 'no-api' }

/**
 * Whether voice notes can be recorded here at all.
 *
 * The browser share in Pakistan is roughly three-quarters Chrome, a tenth UC
 * Browser and a twentieth Opera, most of that Opera Mini. Opera Mini renders
 * pages on Opera's servers and has no microphone API; UC Browser has one on
 * paper and a permission flow that fails without prompting. A link opened from
 * Facebook or Instagram lands in that app's own web view, which can show a
 * permission prompt and then refuse anyway.
 *
 * The old code answered all of these with "allow the microphone in your phone's
 * settings", which on these browsers is advice that cannot be followed. What
 * they need is Chrome, and a button that opens it.
 */
export function browserSupport(
  ua: string,
  caps: { mediaDevices: boolean; recorder: boolean },
): Support {
  if (/Opera Mini/i.test(ua)) return { ok: false, why: 'opera-mini' }
  if (inAppBrowser(ua)) return { ok: false, why: 'in-app' }
  if (!caps.mediaDevices || !caps.recorder)
    return { ok: false, why: /UCBrowser|UCWEB/i.test(ua) ? 'uc' : 'no-api' }
  return { ok: true }
}

/**
 * A page opened inside another app, not in a browser. Android's web view marks
 * itself with "; wv)"; Facebook, Messenger and Instagram add their own names.
 * WhatsApp is not on this list on purpose: on Android it opens links in a
 * Chrome custom tab, which is Chrome.
 */
export function inAppBrowser(ua: string): boolean {
  return /; wv\)|FBAN|FBAV|Instagram|Messenger|Snapchat|TikTok|BytedanceWebview|musical_ly/i.test(ua)
}

export const isAndroid = (ua: string) => /Android/i.test(ua)
export const isIOS = (ua: string) => /iPhone|iPad|iPod/i.test(ua)

/** The mark Android brings a rider back with when Chrome was not there to open. */
export const NO_CHROME = 'chrome'

/**
 * A link that opens this page in Chrome on Android, from inside any other app
 * or browser. If Chrome is not installed, Android loads the fallback instead:
 * the same page, marked so that it does not try again.
 */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href)
  const back = new URL(href)
  back.searchParams.set(NO_CHROME, 'no')
  return (
    `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;` +
    `package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(back.href)};end`
  )
}

/**
 * Whether to hand this visit straight to Chrome, and where to.
 *
 * A rider who opens the link in UC Browser, Opera Mini or Facebook's own
 * browser used to get a sheet with a button, on the first thing that failed.
 * Now, on Android, the page opens itself in Chrome before they see anything —
 * if the phone has Chrome. If it does not, Android brings them back here with
 * the ?chrome=no mark, and the app carries on in the browser they have.
 *
 * Never for a rider who has already answered something: their conversation
 * lives in this browser's storage, and Chrome would start them from nothing.
 * The sheet's button is still there for them.
 */
export function chromeHandoff(v: {
  ua: string
  caps: { mediaDevices: boolean; recorder: boolean }
  href: string
  /** The rider has said something in this browser. */
  answered: boolean
  /** Already tried this session; the page has come back, or never left. */
  tried: boolean
}): string | null {
  if (!isAndroid(v.ua) || v.tried || v.answered) return null
  if (new URL(v.href).searchParams.get(NO_CHROME) === 'no') return null
  const uc = /UCBrowser|UCWEB/i.test(v.ua)
  if (!uc && browserSupport(v.ua, v.caps).ok) return null
  return chromeIntentUrl(v.href)
}

export type MicFailure = 'blocked' | 'busy' | 'none' | 'other'

/**
 * Why getUserMedia refused, in terms the sheet can act on.
 *
 * `NotAllowedError` is the permission — dismissed, denied, or denied once and
 * remembered, which is the case that used to loop: every tap asked again and
 * every ask was refused without a prompt. `NotReadableError` is a microphone
 * that exists but is held by another app, usually a call. `NotFoundError` is a
 * phone with no microphone the browser can see, which is rare on a phone and
 * common in a web view.
 */
export function classifyMicFailure(err: unknown): MicFailure {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
    return 'blocked'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return 'busy'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return 'none'
  return 'other'
}
