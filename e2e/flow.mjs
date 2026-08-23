/**
 * Browser tests for the things unit tests cannot see: that messages arrive one
 * at a time, that the newest line stays against the composer, and that a rider
 * who sends the wrong document twice is answered twice.
 *
 * Both of those last two were real bugs. They were invisible to unit tests and
 * to the built-in preview, whose page is always backgrounded and so throttles
 * timers to about a second a tick.
 *
 *   npx playwright install chromium     # once
 *   npm run e2e                         # against a locally running app
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const APP = process.env.APP ?? 'http://localhost:3099'
const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`  ok    ${name}`)
  } catch (err) {
    results.push(`  FAIL  ${name}\n        ${err.message}`)
    process.exitCode = 1
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

/** Drops the rider straight onto a step, so a test is not six uploads long. */
const primeAt = async (step, history) => {
  await page.goto(APP)
  await page.evaluate(
    ([s, h]) => {
      localStorage.clear()
      localStorage.setItem(
        'grok-bot:flow',
        JSON.stringify({
          step: s,
          firstName: 'Monis',
          fullName: 'Monis Ur Rahmaan',
          cnic: '',
          collected: {},
          ineligible: false,
        }),
      )
      localStorage.setItem('grok-bot:history', JSON.stringify(h))
    },
    [step, history],
  )
  await page.reload()
}

/** A picture that is definitely not a document, made in the page. */
const sendMadeUpPhoto = async () => {
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 900
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#7a9fd4'
    g.fillRect(0, 0, 900, 600)
    g.fillStyle = '#eee'
    g.beginPath()
    g.arc(450, 300, 160, 0, Math.PI * 2)
    g.fill()
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'holiday.jpg', { type: 'image/jpeg' }))
    const input = document.querySelector('input[type=file]:not([capture])')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const stored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]'))

const settle = async (predicate, timeout = 45_000) => {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await predicate()) return true
    await page.waitForTimeout(120)
  }
  return false
}

await check('the page is not backgrounded, so timers are real', async () => {
  await page.goto(APP)
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible')
})

await check('the welcome arrives one message at a time, pinned to the bottom', async () => {
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  const t0 = Date.now()
  await page.reload()

  let worstGap = 0
  const counts = new Set()
  const done = await settle(async () => {
    const s = await page.evaluate(() => {
      const el = document.querySelector('.scroll')
      if (!el) return null
      return {
        shown: el.children.length,
        gap: el.scrollHeight - el.scrollTop - el.clientHeight,
        total: JSON.parse(localStorage.getItem('grok-bot:history') || '[]').length,
      }
    })
    if (!s) return false
    worstGap = Math.max(worstGap, s.gap)
    counts.add(s.shown)
    return s.total > 0 && s.shown === s.total
  })
  const elapsed = Date.now() - t0

  assert.ok(done, 'the welcome never finished arriving')
  assert.ok(counts.size > 3, `messages appeared in ${counts.size} steps, so they were not staged`)
  assert.ok(elapsed < 8000, `the welcome took ${elapsed}ms, which is a wait rather than a flourish`)
  assert.ok(worstGap < 24, `drifted ${Math.round(worstGap)}px from the bottom; the rider would have to scroll`)

  const kinds = await page.evaluate(() =>
    [...document.querySelector('.scroll').children].map((c) =>
      c.querySelector('img.photo') ? 'IMG' : c.querySelector('.voice') ? 'AUD' : 'TXT',
    ),
  )
  assert.deepEqual(kinds, ['IMG', 'AUD', 'TXT', 'TXT', 'TXT', 'TXT', 'AUD'])
})

await check('a returning rider sees the whole thread at once', async () => {
  await page.reload()
  const s = await page.evaluate(() => ({
    shown: document.querySelector('.scroll').children.length,
    total: JSON.parse(localStorage.getItem('grok-bot:history') || '[]').length,
  }))
  assert.equal(s.shown, s.total, 'history was replayed instead of shown')
})

await check('a wrong document is refused, and its voice note stays put', async () => {
  await primeAt(3, [
    { role: 'assistant', content: 'Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.' },
  ])
  await sendMadeUpPhoto()

  const refused = await settle(async () =>
    (await stored()).some((m) => (m.content || '').includes('nahi lag rahi')),
  )
  assert.ok(refused, 'the wrong document was not refused')

  // The bug: the player appeared and then removed itself.
  const heard = await settle(async () =>
    page.evaluate(() => {
      const a = document.querySelector('.voice audio')
      return !!a && a.readyState > 0 && !a.error
    }),
  )
  assert.ok(heard, 'the refusal had no working voice note')

  await page.waitForTimeout(2500)
  const stillThere = await page.evaluate(() => !!document.querySelector('.voice audio'))
  assert.ok(stillThere, 'the voice note vanished after appearing')

  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.equal(step, 3, 'a refused document advanced the flow')
})

await check('a second wrong document is refused again', async () => {
  await sendMadeUpPhoto()
  const twice = await settle(async () => {
    const h = await stored()
    return h.filter((m) => (m.content || '').includes('nahi lag rahi')).length >= 2
  })
  assert.ok(twice, 'the second attempt got no answer at all')
})

await browser.close()
console.log(results.join('\n'))
console.log(process.exitCode ? '\n  some browser tests failed' : '\n  all browser tests passed')
