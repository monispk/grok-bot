/**
 * Waits for the live site to be running a particular commit.
 *
 * Every earlier attempt at this was a hand-rolled shell loop, and each one
 * failed differently: a hostname that did not exist, `set -- $line` (zsh does
 * not word-split), `status` (read-only in zsh), and a Railway CLI call inside
 * every iteration, which costs seconds and dwarfs the check itself. /healthz
 * answers in about 300ms and now names its own commit, so this asks the site.
 *
 *   node scripts/await-deploy.mjs [commit] [--host=https://...]
 *
 * Defaults to HEAD. Exits 0 when live, 1 on timeout.
 */
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const flag = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback

const HOST = flag('host', 'https://foodpanda.rozeegpt.ai')
const TIMEOUT = Number(flag('timeout', 600)) * 1000
const want = (args.find((a) => !a.startsWith('--')) ??
  execSync('git rev-parse HEAD').toString().trim()).slice(0, 7)

const started = Date.now()
let last = ''
process.stdout.write(`waiting for ${want} on ${HOST}\n`)

while (Date.now() - started < TIMEOUT) {
  let live = ''
  try {
    const res = await fetch(`${HOST}/healthz`, { signal: AbortSignal.timeout(8000) })
    const body = await res.json()
    live = String(body.commit ?? '')
    if (live === want) {
      const secs = ((Date.now() - started) / 1000).toFixed(0)
      console.log(`live after ${secs}s: ${JSON.stringify(body)}`)
      process.exit(0)
    }
  } catch {
    live = 'unreachable'
  }
  if (live !== last) {
    process.stdout.write(`  ${((Date.now() - started) / 1000).toFixed(0)}s: ${live || '(no commit)'}\n`)
    last = live
  }
  await new Promise((r) => setTimeout(r, 3000))
}
console.error(`timed out after ${TIMEOUT / 1000}s; still on "${last}"`)
process.exit(1)
