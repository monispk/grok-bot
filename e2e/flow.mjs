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

// The fake device makes getUserMedia hand back a synthetic tone, so the mic can
// be exercised without a microphone and without a prompt to click.
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-capture'],
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
})
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

/** Records for long enough that MediaRecorder emits real bytes, then sends. */
const speak = async (ms = 1200) => {
  await page.click('button.mic')
  await page.waitForSelector('footer.recbar')
  await page.waitForTimeout(ms)
  await page.click('footer.recbar button.send')
}

await check('a spoken answer is transcribed, answered, and the step asked again', async () => {
  await primeAt(3, [
    { role: 'assistant', content: 'Ab apne driving license ke saamne wale hissay (front) ki tasveer bhejein.' },
  ])
  await page.waitForSelector('button.mic')
  await speak()

  // The rider's own clip appears immediately, pending, with a working player.
  const bubble = await settle(
    () => page.evaluate(() => !!document.querySelector('.msg.user .voice audio')),
    10_000,
  )
  assert.ok(bubble, 'the recording never appeared as a message')

  const shown = await settle(async () =>
    page.evaluate(() => {
      const t = document.querySelector('.msg.user .transcript')
      return !!t && t.textContent.trim().length > 0
    }),
  )
  assert.ok(shown, 'what was heard was never shown under the clip')

  // Not merely "an assistant message followed" — the step re-asks itself, so
  // that stayed true while the model call was failing and the rider's question
  // went unanswered. Demand the answer itself.
  const answered = await settle(async () => {
    const h = await stored()
    const i = h.findIndex((m) => m.role === 'user' && (m.content || '').includes('paise'))
    if (i < 0) return false
    return h.slice(i + 1).some((m) => (m.content || '').includes('mock upstream'))
  })
  assert.ok(answered, 'the question was never answered, only the step re-asked')

  const reasked = await settle(async () =>
    (await stored()).some((m) => (m.content || '').includes('license')),
  )
  assert.ok(reasked, 'the step did not ask again after answering')

  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.equal(step, 3, 'a spoken question skipped the document step')
})

await check('the transcript survives a reload, though the clip cannot', async () => {
  await page.reload()
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('grok-bot:history')).some(
      (m) => m.role === 'user' && (m.content || '').includes('paise'),
    ),
  )
  assert.ok(kept, 'what the rider said was lost on reload')
})

await check('the name must be typed, not spoken', async () => {
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await settle(async () => (await stored()).length >= 7)
  await page.waitForSelector('button.mic')
  await speak(900)

  const told = await settle(async () =>
    (await stored()).some((m) => (m.content || '').includes('likh kar bhejein')),
  )
  assert.ok(told, 'a spoken name was accepted instead of being sent back')

  const named = await page.evaluate(
    () => JSON.parse(localStorage.getItem('grok-bot:flow') || '{}').firstName,
  )
  assert.ok(!named, `what was heard was taken as the rider's name (${named})`)
})

await check('a question tucked into an answer is not dropped', async () => {
  // The rider answered the smartphone question and asked about pay in the same
  // breath. The answer was taken, the question thrown away, and they had to ask
  // it a second time.
  await primeAt(1, [
    { role: 'assistant', content: 'Kya aap ke paas apna baray screen wala touch phone hai?' },
  ])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'haan mere paas hai magar pehle bataein ke salary kitni mile gi?')
  await page.click('footer button.send')

  const answered = await settle(async () =>
    (await stored()).some((m) => (m.content || '').includes('mock upstream')),
  )
  assert.ok(answered, 'the question inside the answer went unanswered')

  const moved = await settle(async () => {
    const h = await stored()
    return (
      h.some((m) => (m.content || '').includes('Theek hai')) &&
      h.some((m) => (m.content || '').includes('selfie'))
    )
  })
  assert.ok(moved, 'answering the question stalled the flow')

  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.equal(step, 2, `the flow did not advance past the smartphone question (step ${step})`)
})

const speechOn = await fetch(`${APP}/healthz`)
  .then((r) => r.json())
  .then((h) => !!h.speech)
  .catch(() => false)

const spoken = speechOn ? check : async (name) => results.push(`  skip  ${name} (no UPLIFT_API_KEY)`)

await spoken('an answer the bot invents is spoken too', async () => {
  // The scripted questions have recordings; nobody could record an answer that
  // had not been written yet, so a rider who reads poorly heard every question
  // and none of the replies.
  await primeAt(3, [
    { role: 'assistant', content: 'Ab apne driving license ki tasveer bhejein.' },
  ])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'salary kitni milti hai')
  await page.click('footer button.send')

  const read = await settle(async () =>
    page.evaluate(() => {
      const players = [...document.querySelectorAll('.msg.bot .voice audio')]
      return players.some((a) => a.currentSrc.includes('/api/speak/'))
    }),
  )
  assert.ok(read, 'the answer was never read out')

  // And it must be a real, playable file rather than a bubble pointing nowhere.
  const plays = await settle(async () =>
    page.evaluate(() => {
      const a = [...document.querySelectorAll('.msg.bot .voice audio')].find((x) =>
        x.currentSrc.includes('/api/speak/'),
      )
      return !!a && a.readyState > 0 && !a.error
    }),
  )
  assert.ok(plays, 'the spoken answer would not play')

  const spinning = await page.evaluate(
    () => !!document.querySelector('.msg.bot.media.pending .spinner'),
  )
  assert.ok(!spinning, 'a spinner was left behind after the voice arrived')
})

await browser.close()
console.log(results.join('\n'))
console.log(process.exitCode ? '\n  some browser tests failed' : '\n  all browser tests passed')
