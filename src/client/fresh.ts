/**
 * Notices when the page itself is out of date, and replaces it.
 *
 * The whole app ships inside one index.html. For a while that document was
 * served with nothing said about caching, and phones drew their own
 * conclusions — so a focus group and a day of testing ran against a build that
 * had been replaced several times over, and every fix looked like it had not
 * worked. The document is re-checked on every load now, but a phone that
 * cached it before that change keeps its copy until its own heuristic lets go,
 * and nothing on the server can reach it.
 *
 * So the page checks for itself. /healthz is never cached and reports the
 * commit the server is running; the page knows the commit it was built from.
 * When they differ, it reloads once with that commit in the query, which is a
 * URL no cache has an answer for.
 *
 * Once, and only once per version: if the reload comes back stale as well —
 * a cache more stubborn than this, or a proxy in the way — it stops rather
 * than spinning. A rider seeing an old page is a problem; a rider watching it
 * reload forever is a worse one.
 */
declare const __COMMIT__: string

export const TRIED = 'grok-bot:reloaded-for'

/**
 * Where to go, if anywhere, given what this page was built from and what the
 * server is running. Pure, because the interesting part is the reasoning and
 * the build-time constant cannot be set from a test.
 */
export function staleTarget(v: {
  built: string
  live: string
  href: string
  tried: string | null
}): string | null {
  if (!v.built) return null // a local build, which is never stale
  if (!v.live || v.live === v.built) return null
  if (v.tried === v.live) return null // already tried for this one; do not spin
  const url = new URL(v.href)
  url.searchParams.set('v', v.live)
  return url.href
}

/**
 * How often an open page asks again.
 *
 * Checking only at load was not enough. A tab opened a minute before a deploy
 * keeps the old build for as long as it stays open — which is exactly the
 * case that kept happening: a fix went out, the rider's page had loaded
 * moments earlier, and the very conversation that proved the fix ran against
 * the build without it.
 */
const AGAIN_MS = 60_000

/**
 * Set by the app while a rider is mid-turn — typing, or waiting on an answer.
 *
 * A reload is safe: the thread and the flow are both on disk and come back.
 * What does not come back is the half-typed message in the composer, so a page
 * that has gone stale waits for a quiet moment rather than taking one.
 */
let held = false
export const holdFresh = (busy: boolean) => {
  held = busy
}

export function keepFresh(): void {
  const built = typeof __COMMIT__ === 'string' ? __COMMIT__ : ''
  if (!built) return

  // The first check is the page arriving: there is nothing to interrupt yet,
  // and the sooner a stale page goes the less of the conversation it spoils.
  let first = true
  let stop = false

  const check = () => {
    if (stop) return
    void fetch('/healthz', { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: { commit?: string }) => {
        const live = s.commit ?? ''
        let tried: string | null = null
        try {
          tried = sessionStorage.getItem(TRIED)
        } catch {
          stop = true
          return // no storage means no way to stop a loop, so do not start one
        }
        const go = staleTarget({ built, live, href: location.href, tried })
        if (!go) return
        // Stale, but the rider is busy. Leave it; the next check will ask again.
        if (!first && held) return
        try {
          sessionStorage.setItem(TRIED, live)
        } catch {
          stop = true
          return
        }
        console.warn(`stale page (${built}), the server is on ${live} — reloading`)
        location.replace(go)
      })
      .catch(() => {
        /* offline, or the check itself failed: the page it has is the page it keeps */
      })
      .finally(() => {
        first = false
      })
  }

  check()
  setInterval(check, AGAIN_MS)
  // A phone that was put down and picked up again has probably missed one.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
}
