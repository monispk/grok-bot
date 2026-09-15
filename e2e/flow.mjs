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
import { STEP_SPECS, WELCOME_LINES } from '../src/shared/steps.ts'
import { GAP_MS } from '../src/client/autoplay.ts'
import { BEAT_MS, GROUP_MS } from '../src/client/pace.ts'

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
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-capture',
    // A real browser refuses sound until the page is touched; the app handles
    // that by waiting for the first tap. These tests are about the queue.
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const ctx = await browser.newContext({
  permissions: ['microphone'],
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
})
const page = await ctx.newPage()

/**
 * The sequence, by name. Tests say which step they mean rather than which
 * number: the order has changed once already, and bare indices moved every
 * test onto the wrong question without a single failure to show for it.
 *
 * Read from the app rather than copied. A copy drifted the moment a step was
 * inserted in the middle — it went on naming steps correctly while pointing at
 * the wrong ones, which is the failure the names were meant to prevent.
 */
const ORDER = STEP_SPECS.map((s) => s.id)

/**
 * What the opening should look like on screen, kind by kind: the photograph,
 * the spoken welcome, a bubble per written line, then the first question and
 * its recording.
 *
 * Derived, not written out. As a literal it went stale the moment the welcome
 * gained a line, and then failed three tests that were about staging and
 * grouping rather than about how many bubbles the welcome has.
 */
const WELCOME_SHAPE = [
  'IMG',
  'AUD',
  ...WELCOME_LINES.map(() => 'TXT'),
  'TXT',
  ...(STEP_SPECS[0].audio ? ['AUD'] : []),
]
const at = (id) => {
  const i = ORDER.indexOf(id)
  if (i < 0) throw new Error(`no such step: ${id}`)
  return i
}

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
  assert.ok(elapsed < 6 * GROUP_MS + 4000, `the welcome took ${elapsed}ms, which is a wait rather than a rhythm`)
  assert.ok(worstGap < 24, `drifted ${Math.round(worstGap)}px from the bottom; the rider would have to scroll`)

  const kinds = await page.evaluate(() =>
    [...document.querySelector('.scroll').children].map((c) =>
      c.querySelector('img.photo') ? 'IMG' : c.querySelector('.voice') ? 'AUD' : 'TXT',
    ),
  )
  assert.deepEqual(kinds, WELCOME_SHAPE)
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
  await primeAt(at('license_front'), [
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
  assert.equal(step, at('license_front'), 'a refused document advanced the flow')
})

await check('a second wrong document is refused again', async () => {
  await sendMadeUpPhoto()
  const twice = await settle(async () => {
    const h = await stored()
    return h.filter((m) => (m.content || '').includes('nahi lag rahi')).length >= 2
  })
  assert.ok(twice, 'the second attempt got no answer at all')
})

await check('the camera and paperclip are live only when a document is asked for', async () => {
  const composer = () =>
    page.evaluate(() => ({
      camera: !document.querySelector('button.camera')?.disabled,
      clip: !document.querySelector('button.attach')?.disabled,
    }))

  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  assert.deepEqual(await composer(), { camera: true, clip: true }, 'a document step')

  // A saved photograph is the one thing the face match exists to catch, so the
  // selfie can only come off the camera.
  await primeAt(at('selfie'), [{ role: 'assistant', content: 'Selfie bhejein.' }])
  assert.deepEqual(await composer(), { camera: true, clip: false }, 'the selfie step')

  await primeAt(at('smartphone'), [{ role: 'assistant', content: 'Touch phone hai?' }])
  assert.deepEqual(await composer(), { camera: false, clip: false }, 'a question step')

  // Still on the page, not removed: buttons that come and go read as broken.
  const there = await page.evaluate(
    () => !!document.querySelector('button.camera') && !!document.querySelector('button.attach'),
  )
  assert.ok(there, 'the buttons disappeared instead of greying out')
})

await check('saying "I have neither" at the number question is not asked again', async () => {
  await primeAt(at('phone'), [{ role: 'assistant', content: 'Aap ka mobile number kya hai?' }])
  await page.waitForSelector('footer textarea')

  // Verbatim from a live conversation: Whisper's rendering of "mera koi
  // Easypaisa ya JazzCash account nahi hai". The کیا inside کیاش made this a
  // question, so it was answered with a lecture instead of recorded.
  await page.fill('footer textarea', 'میرا کوئی ایزی پیسہ ہے جاس کیاش ایک انٹ نہیں ہے')
  await page.click('footer button.send')

  const recorded = await settle(async () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow') || '{}').rail === 'neither'),
  )
  assert.ok(recorded, 'the answer was not recorded as having neither wallet')

  await page.fill('footer textarea', '03348234444')
  await page.click('footer button.send')

  // Straight past the wallet question to the one after it.
  const moved = await settle(async () =>
    page.evaluate(
      (want) => JSON.parse(localStorage.getItem('grok-bot:flow') || '{}').step === want,
      at('smartphone'),
    ),
  )
  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.ok(moved, `stopped on ${ORDER[step]} instead of skipping wallet`)

  const asked = (await stored()).some((m) => (m.content || '').includes('Easypaisa hai ya JazzCash'))
  assert.ok(!asked, 'the wallet question was asked after the rider said they had neither')
})

/** Where the microphone button is, so the mouse can hold it. */
const micAt = async () => {
  const box = await page.locator('button.mic').boundingBox()
  if (!box) throw new Error('no microphone button on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Holds the microphone for long enough that MediaRecorder emits real bytes, then lets go. */
const speak = async (ms = 1200) => {
  const { x, y } = await micAt()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForSelector('footer.recording')
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

await check('a tap on the microphone is a hint, not a recording', async () => {
  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  await page.waitForSelector('button.mic')
  const before = (await stored()).length
  const { x, y } = await micAt()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForSelector('.toast')
  await page.waitForTimeout(600)
  const sent = await page.evaluate(() => document.querySelectorAll('.msg.user .voice').length)
  assert.equal(sent, 0, 'a tap sent a recording')
  // The hint is also said aloud, once, so the rider who cannot read it hears it.
  const said = (await stored()).filter((m) => (m.content || '').includes('dabaye rakhein'))
  assert.equal(said.length, 1, 'the hold-to-talk line was not said exactly once')
  assert.ok((await stored()).length > before)
})

await check('sliding left cancels the recording', async () => {
  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  await page.waitForSelector('button.mic')
  const { x, y } = await micAt()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForSelector('footer.recording')
  await page.waitForTimeout(900)
  await page.mouse.move(x - 160, y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.ok(await page.$('footer.idle'), 'the composer did not come back')
  const sent = await page.evaluate(() => document.querySelectorAll('.msg.user .voice').length)
  assert.equal(sent, 0, 'a cancelled recording was sent')
})

await check('sliding up locks the recording, and the bar sends it', async () => {
  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  await page.waitForSelector('button.mic')
  const { x, y } = await micAt()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForSelector('footer.recording')
  await page.mouse.move(x, y - 130, { steps: 10 })
  await page.mouse.up()
  await page.waitForSelector('footer.locked', { timeout: 3000 })
  // The lock was seen to shut, and the bar is WhatsApp's: bin, clock, stop, send.
  assert.ok(await page.$('.lockpill.locked'), 'the padlock did not shut on screen')
  // Hands off, still recording.
  await page.waitForTimeout(1200)
  assert.ok(await page.$('footer.locked .bin'), 'no bin while locked')
  assert.ok(await page.$('footer.locked .stoprec'), 'no stop while locked')
  // Stop: the recording ends and can be heard back before it goes anywhere.
  await page.click('footer.locked .stoprec')
  await page.waitForSelector('footer.reviewing .review .voice', { timeout: 3000 })
  const sentEarly = await page.evaluate(() => document.querySelectorAll('.msg.user .voice').length)
  assert.equal(sentEarly, 0, 'stop sent the recording instead of holding it')
  await page.click('footer.reviewing button.send')
  const sent = await settle(async () =>
    page.evaluate(() => document.querySelectorAll('.msg.user .voice').length === 1),
  )
  assert.ok(sent, 'the held recording was not sent from the bar')
})

await check('a held recording can be thrown away instead', async () => {
  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  await page.waitForSelector('button.mic')
  const { x, y } = await micAt()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForSelector('footer.recording')
  await page.mouse.move(x, y - 130, { steps: 10 })
  await page.mouse.up()
  await page.waitForSelector('footer.locked')
  await page.waitForTimeout(900)
  await page.click('footer.locked .stoprec')
  await page.waitForSelector('footer.reviewing')
  await page.click('footer.reviewing .bin')
  await page.waitForSelector('footer.idle')
  await page.waitForTimeout(400)
  const sent = await page.evaluate(() => document.querySelectorAll('.msg.user .voice').length)
  assert.equal(sent, 0, 'a binned recording was sent')
})

await check('a blocked microphone gets the guide, said once', async () => {
  // Chrome answers a blocked site without a prompt. The old code asked on
  // every tap and said the same thing every time.
  const blocked = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await blocked.addInitScript(() => {
    const denied = { state: 'denied', addEventListener() {}, removeEventListener() {} }
    navigator.permissions.query = () => Promise.resolve(denied)
  })
  const p2 = await blocked.newPage()
  await p2.goto(APP)
  await p2.evaluate(() => localStorage.clear())
  await p2.reload()
  await p2.waitForSelector('button.mic')
  const box = await p2.locator('button.mic').boundingBox()
  const tap = async () => {
    await p2.mouse.move(box.x + 20, box.y + 20)
    await p2.mouse.down()
    await p2.waitForTimeout(100)
    await p2.mouse.up()
  }
  await tap()
  await p2.waitForSelector('.sheet')
  const guide = await p2.evaluate(() => document.querySelector('.sheet')?.textContent || '')
  assert.ok(guide.includes('Permissions'), 'the guide does not say where to go')
  assert.ok(await p2.$('.sheet .sheet-steps'), 'no steps drawn')
  // Close, tap again: the sheet returns, the chat does not repeat itself.
  await p2.click('.sheetback', { position: { x: 10, y: 10 } })
  await p2.waitForSelector('.sheet', { state: 'detached' })
  await tap()
  await p2.waitForSelector('.sheet')
  const said = await p2.evaluate(() =>
    JSON.parse(localStorage.getItem('grok-bot:history') || '[]').filter((m) =>
      (m.content || '').includes('Microphone band hai'),
    ).length,
  )
  assert.equal(said, 1, `the blocked line was said ${said} times`)
  await blocked.close()
})

await check('an unsupported browser hands a fresh visit to Chrome by itself, once', async () => {
  const FB =
    'Mozilla/5.0 (Linux; Android 12; V2027) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/447.0.0.35.108;]'
  const tried = (pg) => pg.evaluate(() => sessionStorage.getItem('grok-bot:chrome-tried') || '')

  // Fresh: the page tries Chrome before drawing anything. Headless Chromium
  // has no handler for intent:// and stays put, which is also what a phone
  // without Chrome does — so the page must still work afterwards.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: FB })
  const p1 = await fresh.newPage()
  // 'commit', not 'load': the hand-off replaces the location while the page
  // is still loading, so the original document's load event never fires.
  await p1.goto(APP, { waitUntil: 'commit' })
  await p1.waitForSelector('button.mic', { timeout: 10_000 })
  assert.ok((await tried(p1)).startsWith('intent://'), 'a fresh visit did not try Chrome')
  // A reload in the same tab does not try again.
  await p1.reload()
  await p1.waitForSelector('button.mic')
  assert.ok((await tried(p1)).startsWith('intent://'))
  // And coming back marked ?chrome=no never tries at all, storage or not.
  const p1b = await fresh.newPage()
  await p1b.goto(`${APP}/?chrome=no`)
  await p1b.waitForSelector('button.mic')
  assert.equal(await tried(p1b), '', 'the fallback page tried Chrome again')
  await fresh.close()

  // Mid-conversation: the answers live here, so the rider stays here.
  const busy = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: FB })
  const p2 = await busy.newPage()
  await p2.goto(`${APP}/?chrome=no`)
  await p2.evaluate(() => {
    localStorage.setItem('grok-bot:history', JSON.stringify([
      { role: 'assistant', content: 'Naam?' },
      { role: 'user', content: 'Monis' },
    ]))
  })
  await p2.goto(APP)
  await p2.waitForSelector('button.mic')
  assert.equal(await tried(p2), '', 'a rider mid-conversation was handed to Chrome')
  await busy.close()

  // Chrome itself, which is what a WhatsApp link opens in: nothing happens.
  assert.equal(await tried(page), '', 'Chrome was handed to Chrome')
})

await check('a browser that cannot record is sent to Chrome', async () => {
  const inApp = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 12; V2027) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/447.0.0.35.108;]',
  })
  const p3 = await inApp.newPage()
  await p3.goto(`${APP}/?chrome=no`)
  await p3.evaluate(() => localStorage.clear())
  await p3.reload()
  await p3.waitForSelector('button.mic')
  const box = await p3.locator('button.mic').boundingBox()
  await p3.mouse.move(box.x + 20, box.y + 20)
  await p3.mouse.down()
  await p3.waitForTimeout(100)
  await p3.mouse.up()
  await p3.waitForSelector('.sheet')
  const href = await p3.evaluate(() => document.querySelector('.sheet a.sheet-main')?.getAttribute('href') || '')
  assert.ok(href.startsWith('intent://'), `no Chrome link, got "${href}"`)
  assert.ok(href.includes('package=com.android.chrome'))
  await inApp.close()
})

await check("the camera button opens the phone's camera app, back or front", async () => {
  // A phone, so the button is on screen: it is hidden where a mouse hovers.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const p4 = await phone.newPage()
  const open = async (step, msg) => {
    await p4.goto(APP)
    await p4.evaluate(
      ([s, h]) => {
        localStorage.clear()
        localStorage.setItem('grok-bot:flow', JSON.stringify({
          step: s, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '', collected: {}, ineligible: false,
        }))
        localStorage.setItem('grok-bot:history', JSON.stringify([{ role: 'assistant', content: h }]))
      },
      [step, msg],
    )
    await p4.reload()
    await p4.waitForSelector(`.scroll .msg:has-text("${msg}")`)
    await p4.waitForSelector('button.camera:not([disabled])')
    const [chooser] = await Promise.all([
      p4.waitForEvent('filechooser', { timeout: 5000 }),
      p4.tap('button.camera'),
    ])
    return chooser.element().getAttribute('capture')
  }
  assert.equal(await open(at('license_front'), 'License bhejein.'), 'environment')
  await phone.close()
})

await check('the selfie opens the front camera in the chat, and offers the phone camera if refused', async () => {
  // A file input's capture="user" is only a hint; Samsung's camera app opened
  // the back lens on it. getUserMedia's facingMode is not a hint.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['camera'] })
  const p5 = await phone.newPage()
  const prime = async () => {
    await p5.goto(`${APP}/?chrome=no`)
    await p5.evaluate((s) => {
      localStorage.clear()
      localStorage.setItem('grok-bot:flow', JSON.stringify({ step: s, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '', collected: {}, ineligible: false }))
      localStorage.setItem('grok-bot:history', JSON.stringify([{ role: 'assistant', content: 'Selfie bhejein.' }]))
    }, at('selfie'))
    await p5.reload()
    await p5.waitForSelector('.scroll .msg:has-text("Selfie bhejein.")')
    await p5.waitForSelector('button.camera:not([disabled])')
  }
  await prime()
  await p5.tap('button.camera')
  await p5.waitForSelector('.camsheet video', { timeout: 5000 })
  const facing = await p5.evaluate(() => document.querySelector('.camsheet video')?.classList.contains('mirror'))
  assert.ok(facing, 'the in-chat camera is not the front one')
  await p5.tap('.camsheet-cancel')

  // Refused: the sheet offers the phone's camera, from a tap of its own.
  await p5.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
  })
  await p5.tap('button.camera')
  await p5.waitForSelector('.sheet .sheet-main', { timeout: 8000 })
  const [chooser] = await Promise.all([p5.waitForEvent('filechooser', { timeout: 5000 }), p5.tap('.sheet .sheet-main')])
  assert.equal(chooser.element() && (await chooser.element().getAttribute('capture')), 'user')
  await phone.close()
})

const atCity = async (extra = {}) => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await ctx2.newPage()
  await pg.goto(`${APP}/?chrome=no`)
  await pg.evaluate(
    ([at, more]) => {
      localStorage.clear()
      localStorage.setItem('grok-bot:flow', JSON.stringify({
        step: at, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '3520201427267',
        collected: {}, ineligible: false, phone: '923348234444', rail: 'neither', noWallet: true, ...more,
      }))
      localStorage.setItem('grok-bot:history', JSON.stringify([{ role: 'assistant', content: 'Aap kis sheher mein rehte hain?' }]))
    },
    [at('city'), extra],
  )
  await pg.reload()
  await pg.waitForSelector('footer textarea')
  return pg
}

const sayCity = async (pg, words) => {
  await pg.fill('footer textarea', words)
  await pg.click('footer button.send')
}

await check('a rider in an office city is offered that city, and the tap is taken', async () => {
  /*
   * This replaced a "send your location" button. On the handsets riders use it
   * failed more often than it worked — no fix indoors, no permission prompt in
   * an in-app browser, a network-derived position in the wrong city — and every
   * failure landed on the last step, after three documents had been sent.
   */
  const pg = await atCity()
  await sayCity(pg, 'Islamabad')
  await pg.waitForSelector('.replies .reply.office', { timeout: 25_000 })

  const said = await pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]'))
  assert.ok(said.some((m) => /Achha, Islamabad/.test(m.content || '')), 'the city was not acknowledged')
  assert.equal(await pg.$('.replies .reply.office ~ .reply'), null, 'a way out was offered inside an office city')

  await pg.click('.replies .reply.office:first-child')
  const taken = await settle(async () =>
    pg.evaluate(() => {
      const f = JSON.parse(localStorage.getItem('grok-bot:flow') || '{}')
      return f.branch === 'f8' && f.city === 'Islamabad'
    }),
  )
  assert.ok(taken, 'the office tap was not recorded')
  assert.equal(await pg.$('.replies .reply.office'), null, 'the buttons stayed after choosing')
  await pg.context().close()
})

await check('shorthand and Urdu both resolve to one spelling', async () => {
  const pg = await atCity()
  await sayCity(pg, 'pindi')
  await pg.waitForSelector('.replies .reply.office', { timeout: 25_000 })
  const city = await pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).city)
  assert.equal(city, 'Rawalpindi', `"pindi" resolved to ${city}`)
  await pg.context().close()
})

await check('a rider we have no office for is told so, and can say none of these', async () => {
  const pg = await atCity()
  await sayCity(pg, 'Sukkur')
  await pg.waitForSelector('.replies .reply.office', { timeout: 25_000 })
  const text = async () =>
    (await pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]')))
      .map((m) => m.content || '').join('\n')
  assert.ok((await text()).includes('koi office nahi'), 'not told we have no office there')

  const buttons = await pg.$$('.replies .reply')
  const last = buttons[buttons.length - 1]
  assert.equal((await last.innerText()).trim(), 'In mein se koi nahi', 'no way out at the bottom')

  await last.click()
  const ended = await settle(async () =>
    pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow') || '{}').noOffice === true),
  )
  assert.ok(ended, 'choosing none of them did not end the conversation')
  await pg.waitForTimeout(2000)
  const closing = await text()
  assert.ok(closing.includes('raabta karein ge'), 'no apology and no promise to be in touch')
  assert.ok(!closing.includes('is office aayein'), 'invited to an office anyway')
  const log = await pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]'))
  assert.ok(!log.some((m) => m.kind === 'video'), 'still shown the training video')
  await pg.context().close()
})

await check('the fee waits for the wallet app, and is not called missing while the rider is still approving it', async () => {
  // The mock rail answers "in progress" to the initiate and settles six
  // seconds later, as a rider approving the request in their app would.
  await page.goto(APP)
  await page.evaluate((done) => {
    localStorage.clear()
    localStorage.setItem('grok-bot:flow', JSON.stringify({
      step: done, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '3520201427267', collected: {},
      ineligible: false, phone: '923348234444', rail: 'easypaisa',
      payment: { rail: 'easypaisa', state: 'initiated', amountPaisa: 0, ref: '', detail: '' },
    }))
    localStorage.setItem('grok-bot:history', JSON.stringify([{ role: 'assistant', content: 'Ab registration fee aap ke wallet se li ja rahi hai.' }]))
  }, STEP_SPECS.length)
  await page.reload()
  const pending = await settle(async () => (await stored()).some((m) => (m.content || '').includes('confirm ho rahi hai')), 15_000)
  assert.ok(pending, 'the rider was not told the payment is being confirmed')
  // Nothing final in the first few seconds.
  await page.waitForTimeout(3000)
  assert.ok(!(await stored()).some((m) => (m.content || '').includes('jama nahi hui')), 'called missing while still approving')
  const paid = await settle(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))).payment?.state === 'paid', 30_000)
  assert.ok(paid, 'the payment never settled')
  assert.ok(!(await stored()).some((m) => (m.content || '').includes('jama nahi hui')), 'a paid fee was called missing')
})

/**
 * Runs a rider through the last step — the location — so the ending arrives
 * the way it does in life, rather than by priming a state nothing produces.
 */
const throughTheLastStep = async (extra) => {
  const near = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await near.newPage()
  await pg.goto(`${APP}/?chrome=no`)
  await pg.evaluate(
    ([at, more]) => {
      localStorage.clear()
      localStorage.setItem('grok-bot:flow', JSON.stringify({
        step: at, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '3520201427267',
        collected: { 'checks.faceMatch': 'match (99.0)', 'checks.licenceVsCnic': 'match' },
        ineligible: false, phone: '923348234444', rail: 'easypaisa', ...more,
      }))
      localStorage.setItem('grok-bot:history', JSON.stringify([{ role: 'assistant', content: 'Aap kis sheher mein rehte hain?' }]))
    },
    [ORDER.indexOf('city'), extra],
  )
  await pg.reload()
  await pg.waitForSelector('footer textarea')
  await pg.fill('footer textarea', 'Islamabad')
  await pg.click('footer button.send')
  await pg.waitForSelector('.replies .reply.office', { timeout: 25_000 })
  await pg.click('.replies .reply.office:first-child')
  return pg
}
const textOf = async (pg) =>
  (await pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]')))
    .map((m) => m.content || '').join('\n')
const logOf = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:history') || '[]'))
const waitFor = async (pg, needle, ms = 40_000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if ((await textOf(pg)).includes(needle)) return true
    await pg.waitForTimeout(200)
  }
  return false
}

await check('the ending congratulates, invites to the office, then offers the video and the quiz', async () => {
  /*
   * The order is the requirement. A rider who has just spent ten minutes and
   * two and a half thousand rupees is congratulated and told where to go
   * first — with the pin — and only then asked to watch a video and answer
   * questions. It used to run the other way round, and a rider who stopped
   * reading had the one thing they needed sitting below the fold.
   */
  const pg = await throughTheLastStep({})
  assert.ok(await waitFor(pg, 'register ho gayi'), `never registered: ${(await textOf(pg)).slice(-300)}`)

  const log = await logOf(pg)
  const order = log.map((m) => (m.kind === 'video' ? 'VIDEO' : m.kind === 'location' ? 'PIN' : m.content || ''))
  const idx = (n) => order.findIndex((t) => t.includes(n))
  assert.ok(idx('Mubarak ho') >= 0, 'the rider was never congratulated')
  assert.ok(idx('is office aayein') > idx('Mubarak ho'), 'the office came before the congratulation')
  assert.ok(order.indexOf('PIN') > idx('is office aayein'), 'the pin came before the address')
  assert.ok(order.indexOf('VIDEO') > order.indexOf('PIN'), 'the video came before the invitation')
  assert.ok(idx('chand chhote sawal') > order.indexOf('VIDEO'), 'the questions were offered before the video')
  const invite = await textOf(pg)
  assert.ok(invite.includes('dopahar 12 baje'), 'the office hours are not in the invitation')
  assert.ok(!invite.includes('counter par jama karayein'), 'a rider who paid was asked to pay again')

  await pg.waitForSelector('.replies .reply')
  await pg.click('.replies .reply:last-child')
  assert.ok(await waitFor(pg, 'Office zaroor aayein'), 'declining the quiz never produced the farewell')
  const end = await logOf(pg)
  const pins = end.filter((m) => m.kind === 'location' && (m.src || '').includes('office-f8'))
  assert.equal(pins.length, 2, `the pin should be sent with the invitation and again at the end, got ${pins.length}`)
  assert.ok((await textOf(pg)).includes('asli CNIC'), 'not told to bring their CNIC')
  await pg.context().close()
})

await check('a rider with no wallet is told to pay at the counter, in the invitation', async () => {
  const pg = await throughTheLastStep({ rail: 'neither', noWallet: true })
  assert.ok(await waitFor(pg, 'register ho gayi'), 'never registered')
  // The fee is named in the invitation, where the rider is being told what to
  // bring — not held back until after ten questions.
  assert.ok(await waitFor(pg, 'counter par jama karayein'), 'never told to pay at the office')
  const log = await logOf(pg)
  assert.equal(
    log.filter((m) => (m.content || '').includes('counter par jama karayein')).length,
    1,
    'asked for the fee twice',
  )
  await pg.context().close()
})

await check('a rider waiting on a bike is told to come once they have it', async () => {
  const pg = await throughTheLastStep({ missing: ['bike'], rail: 'neither', noWallet: true })
  assert.ok(await waitFor(pg, 'aa jaye, to is office aayein'), `never directed: ${(await textOf(pg)).slice(-300)}`)
  const text = await textOf(pg)
  assert.ok(text.includes('apni bike'), 'did not say what they are waiting for')
  assert.ok(text.includes('counter par jama karayein'), 'an unpaid rider was not told about the fee')
  assert.ok((await logOf(pg)).some((m) => m.kind === 'location'), 'no pin for a waiting rider')
  await pg.context().close()
})

await check('the quiz is answered by tapping a reply button', async () => {
  await page.goto(APP)
  await page.evaluate((done) => {
    localStorage.clear()
    localStorage.setItem('grok-bot:flow', JSON.stringify({
      step: done, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '', collected: {}, ineligible: false,
      quiz: { offered: true, declined: false, done: false, asked: [], at: 0, answers: [] },
    }))
    localStorage.setItem('grok-bot:history', JSON.stringify([{ role: 'assistant', content: 'Quiz dena chahenge?' }]))
  }, STEP_SPECS.length)
  await page.reload()
  await page.waitForSelector('.replies .reply')
  await page.click('.replies .reply:first-child')
  // The first question, with its options as buttons and not in the bubble.
  await page.waitForSelector('.replies .reply b', { timeout: 15_000 })
  const three = await page.evaluate(() => document.querySelectorAll('.replies .reply').length)
  assert.ok(three >= 2, `only ${three} option buttons`)
  const bubble = await page.evaluate(() => [...document.querySelectorAll('.msg.bot')].map((e) => e.textContent).find((t) => t.includes('Sawaal 1')))
  assert.ok(bubble && !/\bA\)/.test(bubble), 'the options are still listed in the bubble')
  await page.click('.replies .reply:first-child')
  const answered = await settle(async () => {
    const f = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))
    return f.quiz?.answers?.length === 1 && f.quiz.answers[0].chose === 'a'
  })
  assert.ok(answered, 'the tap was not recorded as the answer')
  const shown = (await stored()).some((m) => m.role === 'user' && /^A\) /.test(m.content || ''))
  assert.ok(shown, 'the chosen option is not in the thread')
})

await check('a spoken answer is transcribed, answered, and the step asked again', async () => {
  await primeAt(at('license_front'), [
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
  assert.equal(step, at('license_front'), 'a spoken question skipped the document step')
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
  await primeAt(at('smartphone'), [
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
      h.some((m) => (m.content || '').includes('bike'))
    )
  })
  assert.ok(moved, 'answering the question stalled the flow')

  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.equal(
    step,
    at('bike'),
    `the flow did not advance past the smartphone question (step ${step})`,
  )
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
  await primeAt(at('license_front'), [
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

await spoken('a line with a recording is not also read by Uplift', async () => {
  // Every step question already travels with its own voice note. Reading it
  // aloud as well gave each question two players, one under the other.
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // Wait for the welcome to finish arriving rather than for a fixed time: it is
  // paced in groups now, so a fixed wait catches it half-said.
  const done = await settle(async () =>
    page.evaluate(() => {
      const el = document.querySelector('.scroll')
      const total = JSON.parse(localStorage.getItem('grok-bot:history') || '[]').length
      return !!el && total > 0 && el.children.length === total
    }),
  )
  assert.ok(done, 'the welcome never finished arriving')

  const shape = await page.evaluate(() =>
    [...document.querySelector('.scroll').children].map((c) =>
      c.querySelector('img.photo') ? 'IMG' : c.querySelector('.voice') ? 'AUD' : 'TXT',
    ),
  )
  assert.deepEqual(
    shape,
    WELCOME_SHAPE,
    `the welcome gained voice notes it did not need: ${shape.join(',')}`,
  )

  // And the same at a step, which is where it was noticed. The question has to
  // arrive through the flow: priming writes history straight to storage, which
  // never runs the code that attaches a voice note.
  await primeAt(at('smartphone'), [
    { role: 'assistant', content: 'Kya aap ke paas apna baray screen wala touch phone hai?' },
  ])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'haan')
  await page.click('footer button.send')

  // Answering the smartphone gate brings up the bike gate, which also has a
  // recording — the case this test exists for.
  // On screen, not merely in storage: the thread is paced in pairs now, and
  // storage has the question two seconds before the rider does.
  const onScreen = await settle(async () =>
    page.evaluate(() => {
      const els = [...document.querySelectorAll('.scroll > .msg')]
      const i = els.findIndex((e) => (e.textContent || '').includes('bike'))
      return i >= 0 && !!els[i + 1]?.querySelector('.voice')
    }),
  )
  assert.ok(onScreen, 'the bike question never reached the screen with its voice note')
  await page.waitForTimeout(600)

  // "Theek hai." has a recording of its own now, so the thread holds two voice
  // notes and both are correct. What must never happen is a question carrying
  // two: count the ones that follow the bike question.
  const players = await page.evaluate(() => {
    const kids = [...document.querySelector('.scroll').children]
    const q = kids.findIndex((c) => (c.textContent || '').includes('bike'))
    if (q < 0) return -1
    let n = 0
    for (let i = q + 1; i < kids.length; i++) {
      if (!kids[i].querySelector('.voice')) break
      n++
    }
    return n
  })
  assert.equal(players, 1, `the bike question had ${players} voice notes, not one`)
})

await check('lines arrive in groups, with a pause between them', async () => {
  // A line and its voice note are one utterance and must land together; the next
  // thing said must wait, so a rider who is listening can keep up.
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  // Sample what is on screen, with timings, while the welcome plays out.
  const seen = []
  const until = Date.now() + 20_000
  while (Date.now() < until) {
    const s = await page.evaluate(() => {
      const el = document.querySelector('.scroll')
      if (!el) return null
      return {
        kinds: [...el.children].map((c) =>
          c.querySelector('img.photo') ? 'IMG' : c.querySelector('.voice') ? 'AUD' : 'TXT',
        ),
        total: JSON.parse(localStorage.getItem('grok-bot:history') || '[]').length,
      }
    })
    if (s) {
      const last = seen[seen.length - 1]
      if (!last || last.kinds.join() !== s.kinds.join())
        seen.push({ at: Date.now(), kinds: s.kinds })
      if (s.total > 0 && s.kinds.length === s.total) break
    }
    await page.waitForTimeout(40)
  }

  const shape = seen[seen.length - 1].kinds
  assert.deepEqual(shape, WELCOME_SHAPE)

  // Time from each arrival to the next.
  const gaps = seen.slice(1).map((s, i) => ({ kind: s.kinds[s.kinds.length - 1], ms: s.at - seen[i].at }))

  // A voice note rides just behind the line it speaks.
  const attached = [gaps[0], gaps[gaps.length - 1]]
  for (const g of attached)
    assert.ok(g.ms < BEAT_MS + 300, `a voice note trailed its line by ${g.ms}ms; it should arrive with it`)

  // Between one thing being said and the next there is a real pause.
  const between = gaps.filter((g) => g.kind === 'TXT').map((g) => g.ms)
  assert.ok(between.length >= 3, `only saw ${between.length} gaps between lines`)
  for (const ms of between)
    assert.ok(ms > GROUP_MS - 100, `only ${ms}ms before the next line; asked for ${GROUP_MS}`)

  const total = seen[seen.length - 1].at - seen[0].at
  assert.ok(total < 6 * GROUP_MS + 4000, `the welcome took ${total}ms, which is a wait rather than a rhythm`)
})

/**
 * Watches the thread arrive and notes when each thing first appeared: a bot
 * line by its words, a voice note by the line above it. The pacing rule is
 * about these moments — words, then the voice, then two seconds — so the test
 * measures exactly those.
 */
const arrivals = async (pg, doneWhen, timeout = 40_000) => {
  const first = new Map()
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const now = Date.now()
    const keys = await pg.evaluate(() => {
      const out = []
      let lastText = 'start'
      for (const c of document.querySelectorAll('.scroll > .msg')) {
        if (c.classList.contains('user')) {
          lastText = 'rider'
          out.push('rider')
        } else if (c.querySelector('.voice')) out.push(`voice after ${lastText}`)
        else if (c.querySelector('img.photo')) out.push('photo')
        else {
          lastText = (c.textContent || '').trim().slice(0, 24)
          out.push(lastText)
        }
      }
      return out
    })
    for (const k of keys) if (!first.has(k)) first.set(k, now)
    if (doneWhen(keys)) break
    await pg.waitForTimeout(40)
  }
  return first
}

const seenAt = (first, needle) => {
  for (const [k, at] of first) if (k.includes(needle)) return at
  return null
}

await check('the next pair waits for the last voice note, then the pause', async () => {
  // Reported: two lines and two voice notes landing as one lump. The rule is
  // words, then the voice note, then two seconds before the next words. Here
  // the answer's voice note takes the mock 2.5 seconds to make.
  await primeAt(at('smartphone'), [{ role: 'assistant', content: 'Touch phone hai?' }])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'salary kitni milti hai')
  await page.click('footer button.send')

  const first = await arrivals(page, (k) => k.some((x) => x.startsWith('Kya aap ke paas apna')) && k[k.length - 1].startsWith('voice after Kya'))
  const trail = [...first].map(([k, at]) => `${k} @${at - first.get('rider')}ms`).join('\n')
  const answer = seenAt(first, 'Aap ne poocha')
  const answerVoice = seenAt(first, 'voice after Aap ne poocha')
  const question = seenAt(first, 'Kya aap ke paas apna')
  assert.ok(answer && answerVoice && question, `could not see the arrivals:\n${trail}`)
  assert.ok(answerVoice - answer < 4000, `the answer's voice note took ${answerVoice - answer}ms`)
  const gap = question - answerVoice
  assert.ok(gap >= GROUP_MS - 100, `the question came ${gap}ms after the answer's voice note; asked for ${GROUP_MS}\n${trail}`)
})

await check('a voice note that fails to arrive does not let the next pair jump the queue', async () => {
  // The empty bubble is removed, which shifts every later message up a slot.
  // The message waiting its turn used to land at once because of it.
  await page.route('**/api/speak', (route) => route.fulfill({ status: 500, body: '{"ok":false}' }))
  await page.route('**/api/speak/**', (route) => route.fulfill({ status: 404, body: '' }))
  await primeAt(at('smartphone'), [{ role: 'assistant', content: 'Touch phone hai?' }])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'salary kitni milti hai')
  await page.click('footer button.send')

  const first = await arrivals(page, (k) => k.some((x) => x.startsWith('Kya aap ke paas apna')))
  await page.unroute('**/api/speak')
  await page.unroute('**/api/speak/**')
  const trail = [...first].map(([k, at]) => `${k} @${at - first.get('rider')}ms`).join('\n')
  const answer = seenAt(first, 'Aap ne poocha')
  const question = seenAt(first, 'Kya aap ke paas apna')
  assert.ok(answer && question, `could not see the arrivals:\n${trail}`)
  const gap = question - answer
  assert.ok(gap >= GROUP_MS - 100, `the question came ${gap}ms after the answer; asked for ${GROUP_MS}\n${trail}`)
})

/** An application someone left at the bike question, as the server would hand it back. */
const OLD_ID = '11111111-2222-4333-8444-555555555555'
const earlier = () => ({
  flow: {
    applicationId: OLD_ID, step: at('bike'), firstName: 'Monis', fullName: 'Monis Ur Rahmaan',
    cnic: '', collected: {}, phone: '923348234444', rail: 'easypaisa', noWallet: false,
  },
  history: [
    { role: 'assistant', content: 'Aap ka mobile number kya hai?' },
    { role: 'user', content: '03348234444' },
    { role: 'assistant', content: 'Aap ke paas Easypaisa hai ya JazzCash?' },
    { role: 'user', content: 'easypaisa' },
    { role: 'assistant', content: 'Kya aap ke paas apna baray screen wala touch phone hai?' },
    { role: 'user', content: 'haan, pehle wali baat' },
    { role: 'assistant', content: 'Theek hai.' },
  ],
})
const serverWith = async (pg, found) => {
  await pg.route('**/api/application/lookup', (route) =>
    route.fulfill({ json: found ? { found: true, id: OLD_ID, firstName: 'Monis', step: at('bike'), updatedAt: Date.now() } : { found: false } }))
  await pg.route('**/api/application/resume', (route) => route.fulfill({ json: earlier() }))
}
const freshTo = async (pg, name, phone) => {
  await pg.goto(APP)
  await pg.evaluate(() => localStorage.clear())
  await pg.reload()
  await pg.waitForSelector('footer textarea')
  await pg.fill('footer textarea', name)
  await pg.click('footer button.send')
  await settle(async () => pg.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow') || '{}').step === 1))
  await pg.fill('footer textarea', phone)
  await pg.click('footer button.send')
}

await check('a returning rider is found by number and name, and put back where they were', async () => {
  await serverWith(page, true)
  await freshTo(page, 'Monis Rahman', '03348234444')
  const offered = await settle(async () => (await stored()).some((m) => (m.content || '').includes('pehle bhi application')))
  assert.ok(offered, 'no offer to carry on')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))
  assert.equal(ORDER[before.step], 'phone', 'the flow moved on before the rider answered')

  await page.fill('footer textarea', 'haan')
  await page.click('footer button.send')
  const back = await settle(async () => {
    const f = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))
    return f.applicationId === OLD_ID && ORDER[f.step] === 'bike'
  })
  assert.ok(back, 'the earlier application was not restored')
  const log = await stored()
  assert.ok(log.some((m) => m.content === 'haan, pehle wali baat'), 'the old thread is not on screen')
  assert.ok(log.some((m) => (m.content || '').includes('Wahin se chalte hain')), 'nothing said about carrying on')
  const asked = await settle(async () => (await stored()).some((m) => (m.content || '').includes('apni bike hai')))
  assert.ok(asked, 'the bike question was not asked again')
  await page.unroute('**/api/application/lookup')
  await page.unroute('**/api/application/resume')
})

await check('a rider who says no to carrying on starts fresh', async () => {
  await serverWith(page, true)
  await freshTo(page, 'Monis Rahman', '03348234444')
  await settle(async () => (await stored()).some((m) => (m.content || '').includes('pehle bhi application')))
  const mine = (await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))).applicationId
  await page.fill('footer textarea', 'nahi')
  await page.click('footer button.send')
  const moved = await settle(async () => {
    const f = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))
    return ORDER[f.step] === 'wallet' && f.applicationId === mine && !f.resume
  })
  assert.ok(moved, 'did not carry on with a fresh application')
  await page.unroute('**/api/application/lookup')
  await page.unroute('**/api/application/resume')
})

await check('every answer is sent to the server as it is made', async () => {
  const sent = []
  await page.route('**/api/application/*', (route) => {
    if (route.request().method() === 'PUT') sent.push(JSON.parse(route.request().postData() || '{}'))
    route.fulfill({ json: { ok: true } })
  })
  await serverWith(page, false)
  await freshTo(page, 'Saad Rehman', '03131234567')
  const landed = await settle(async () => sent.some((b) => b.flow?.phone === '923131234567'))
  assert.ok(landed, `the number never reached the server; ${sent.length} pushes seen`)
  const last = sent[sent.length - 1]
  assert.equal(last.flow.fullName, 'Saad Rehman')
  assert.ok(last.history.some((m) => m.role === 'user' && m.content === '03131234567'), 'the thread was not sent')
  assert.ok(!last.history.some((m) => m.src?.startsWith('blob:')), 'a blob URL was sent to the server')
  await page.unroute('**/api/application/*')
  await page.unroute('**/api/application/lookup')
  await page.unroute('**/api/application/resume')
})

await check('the picture buttons are fully in view, and stay full size once tapped', async () => {
  await primeAt(at('smartphone'), [{ role: 'assistant', content: 'Kya aap ke paas touch phone hai?' }])
  await page.waitForSelector('.choices .choice.nahi img')
  // Wait for the pictures themselves, since it is their height that was missing.
  await settle(async () =>
    page.evaluate(() => [...document.querySelectorAll('.choices img')].every((i) => i.complete)),
  )
  await page.waitForTimeout(400)

  const room = await page.evaluate(() => {
    const btn = document.querySelector('.choices .choice.nahi')
    const foot = document.querySelector('footer')
    const b = btn.getBoundingClientRect()
    return { top: b.top, bottom: b.bottom, height: b.height, footTop: foot.getBoundingClientRect().top }
  })
  assert.ok(room.height > 120, `the buttons are only ${Math.round(room.height)}px tall`)
  assert.ok(room.top >= 0, 'the buttons start above the top of the screen')
  assert.ok(room.bottom <= room.footTop + 1, 'the buttons run under the composer')

  await page.click('.choices .choice.nahi')
  await settle(async () => page.evaluate(() => !!document.querySelector('.msg.picked img')))
  await settle(async () => page.evaluate(() => document.querySelector('.msg.picked img').complete))
  const shown = await page.evaluate(() => {
    const el = document.querySelector('.msg.picked')
    const img = el.querySelector('img')
    return { bubble: el.getBoundingClientRect().height, pic: img.getBoundingClientRect().height }
  })
  // The bug: the bubble shared a class with the button and inherited flex: 1,
  // which collapsed it to a few pixels inside the thread's flex column.
  assert.ok(shown.pic > 80, `the chosen picture is ${Math.round(shown.pic)}px tall`)
  assert.ok(shown.bubble > 100, `the bubble is ${Math.round(shown.bubble)}px tall`)
})

await check('a yes-or-no question can be answered by tapping a picture', async () => {
  await primeAt(at('smartphone'), [{ role: 'assistant', content: 'Kya aap ke paas touch phone hai?' }])
  await page.waitForSelector('.choices .choice.nahi')
  const two = await page.evaluate(() => document.querySelectorAll('.choices .choice').length)
  assert.equal(two, 2, 'two pictures, one for each answer')
  await page.click('.choices .choice.nahi')
  const moved = await settle(async () => {
    const f = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')))
    return ORDER[f.step] === 'bike' && (f.missing || []).includes('smartphone')
  })
  assert.ok(moved, 'the tap was not taken as the answer')
  // The picture stays in the thread, on the rider's side, so it is plain what was chosen.
  const kept = await page.evaluate(() => {
    const el = document.querySelector('.msg.user.picked')
    return el ? { img: el.querySelector('img')?.getAttribute('src'), text: el.textContent } : null
  })
  assert.ok(kept?.img?.includes('choice-phone-no'), 'the chosen picture is not in the thread')
  assert.ok(kept?.text?.includes('Nahi'), 'the choice has no words with it')
  // And the bike question brings its own pair.
  await page.waitForSelector('.choices .choice.haan img[src*="bike"]', { timeout: 15_000 })
})

await check('"Sent" at a document step sends nothing and moves nowhere', async () => {
  // Reported: the rider typed "Sent"; the model said the licence had arrived
  // and talked about the deposit. Nothing had arrived.
  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'Sent')
  await page.click('footer button.send')
  const asked = await settle(async () =>
    (await stored()).some((m) => (m.content || '').includes('tasveer chahiye')),
  )
  assert.ok(asked, 'the step was not asked again')
  await page.waitForTimeout(1500)
  const log = await stored()
  assert.ok(!log.some((m) => /Aap ne poocha/.test(m.content || '')), 'the model was consulted about "Sent"')
  assert.ok(!log.some((m) => /mil ga/i.test(m.content || '')), 'something claimed to have been received')
  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.equal(ORDER[step], 'license_front', 'the step moved on without a document')
})

await check('"I don\'t have one" at the licence step is heard, not re-asked', async () => {
  /*
   * Reported with a screenshot: the rider said they had no driving licence
   * twice by voice and once in English, and all three times was told to press
   * the camera button. An upload step only ever expected a file.
   */
  await primeAt(at('license_front'), [{ role: 'assistant', content: 'License bhejein.' }])
  await page.waitForSelector('footer textarea')
  await page.fill('footer textarea', 'mere paas driving license nahi hai')
  await page.click('footer button.send')

  const told = await settle(async () =>
    (await stored()).some((m) => /driving license zaroori hai/.test(m.content || '')),
  )
  assert.ok(told, 'the rider was never told a licence is required')

  const moved = await settle(async () =>
    page.evaluate(() => {
      const f = JSON.parse(localStorage.getItem('grok-bot:flow'))
      return (f.missing || []).includes('license_front')
    }),
  )
  assert.ok(moved, 'the missing licence was not recorded')

  const log = await stored()
  const asked = log.filter((m) => /driving license ke front ki tasveer chahiye/.test(m.content || ''))
  assert.equal(asked.length, 0, 'the step was asked again anyway')

  const step = await page.evaluate(() => JSON.parse(localStorage.getItem('grok-bot:flow')).step)
  assert.ok(step > at('license_front'), 'the flow stayed on a step the rider cannot answer')
})

await spoken('nothing spins while a line is being read', async () => {
  // The spinner is positioned over its bubble. A voice note still being read has
  // an empty bubble with no height, so the spinner escaped and span over the
  // text beside it. Its window is only a few hundred ms, so this watches every
  // frame rather than sampling from here and walking past it.
  await primeAt(at('license_front'), [
    { role: 'assistant', content: 'Ab apne driving license ki tasveer bhejein.' },
  ])
  await page.waitForSelector('footer textarea')
  await page.evaluate(() => {
    window.__spin = 0
    const tick = () => {
      window.__spin = Math.max(window.__spin, document.querySelectorAll('.msg.bot .spinner').length)
      window.__raf = requestAnimationFrame(tick)
    }
    tick()
  })

  await page.fill('footer textarea', 'salary kitni milti hai')
  await page.click('footer button.send')

  const arrived = await settle(async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.msg.bot .voice audio')].some((a) =>
        a.currentSrc.includes('/api/speak/'),
      ),
    ),
  )
  const worst = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf)
    return window.__spin
  })
  assert.ok(arrived, 'the answer was never read out')
  assert.equal(worst, 0, `${worst} spinner(s) span on the bot's side while it was being read`)
})

await check('Clear says the welcome again, a group at a time', async () => {
  // The thread has to be longer than the welcome: the counter was left where the
  // old conversation ended, and only a thread past the welcome's length put it
  // beyond the end, which is what dropped the whole welcome on screen at once.
  await primeAt(at('license_front'), [
    { role: 'assistant', content: 'Aap ka poora naam kya hai?' },
    { role: 'user', content: 'Monis Ur Rahmaan' },
    { role: 'assistant', content: 'Shukriya Monis.' },
    { role: 'assistant', content: 'Kya aap ke paas touch phone hai?' },
    { role: 'user', content: 'haan' },
    { role: 'assistant', content: 'Theek hai.' },
    { role: 'assistant', content: 'Ab apni aik selfie khenchein.' },
    { role: 'user', content: 'ok' },
    { role: 'assistant', content: 'Ab apne CNIC ke saamne wali tasveer bhejein.' },
    { role: 'user', content: 'theek hai' },
  ])
  await page.waitForSelector('header button.clear')
  await page.click('header button.clear')

  const counts = new Set()
  const done = await settle(async () => {
    const s = await page.evaluate(() => {
      const el = document.querySelector('.scroll')
      return el ? { shown: el.children.length, total: JSON.parse(localStorage.getItem('grok-bot:history') || '[]').length } : null
    })
    if (!s) return false
    counts.add(s.shown)
    return s.total > 0 && s.shown === s.total
  })
  assert.ok(done, 'the welcome never finished arriving after Clear')
  assert.ok(
    counts.size > 3,
    `after Clear the welcome appeared in ${counts.size} step(s); it was dropped on screen at once`,
  )
})

await check('voice notes play themselves, one at a time, with a pause', async () => {
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  // Record every play and end, from inside the page, so nothing is missed.
  await page.evaluate(() => {
    window.__log = []
    const watch = (el) => {
      if (el.__watched) return
      el.__watched = true
      el.addEventListener('play', () => window.__log.push({ e: 'play', at: Date.now(), src: el.currentSrc }))
      el.addEventListener('ended', () => window.__log.push({ e: 'end', at: Date.now(), src: el.currentSrc }))
    }
    document.querySelectorAll('audio').forEach(watch)
    new MutationObserver(() => document.querySelectorAll('audio').forEach(watch))
      .observe(document.body, { childList: true, subtree: true })
  })

  // The welcome has two recordings: the introduction and the name question.
  const heard = await settle(
    async () => page.evaluate(() => window.__log.filter((l) => l.e === 'end').length >= 2),
    40_000,
  )
  const log = await page.evaluate(() => window.__log)
  assert.ok(heard, `only heard ${log.filter((l) => l.e === 'end').length} clip(s) play through`)

  // Never two at once.
  let open = 0
  for (const l of log) {
    if (l.e === 'play') open++
    else open--
    assert.ok(open <= 1, 'two voice notes played over each other')
  }

  // At least GAP_MS between one finishing and the next starting. Read from the
  // app: as a literal it would have to be remembered every time the pause is
  // tuned, and a test that is edited to match whatever the code does is not a
  // test. The 50ms is timer slack, not tolerance for a shorter pause.
  for (let i = 0; i < log.length - 1; i++) {
    if (log[i].e !== 'end' || log[i + 1]?.e !== 'play') continue
    const gap = log[i + 1].at - log[i].at
    assert.ok(gap >= GAP_MS - 50, `only ${gap}ms between voice notes; asked for ${GAP_MS}`)
  }
})

await check('answering stops whatever Rozeena was saying', async () => {
  /*
   * A voice note carrying on over an answer is the app talking across the
   * person it is meant to be listening to — and on a phone held to the ear it
   * is the only thing they hear. Every answer silences it: typed, tapped, or
   * spoken. This drives the tapped one, at the bike question, where the answer
   * is a picture.
   */
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await ctx3.newPage()
  await pg.goto(`${APP}/?chrome=no`)
  await pg.evaluate((at) => {
    localStorage.clear()
    localStorage.setItem('grok-bot:flow', JSON.stringify({
      step: at, firstName: 'Monis', fullName: 'Monis Ur Rahmaan', cnic: '',
      collected: {}, ineligible: false, phone: '923348234444', rail: 'neither', noWallet: true,
    }))
    localStorage.setItem('grok-bot:history', JSON.stringify([
      { role: 'assistant', content: 'Kya aap ke paas apni bike hai?' },
      {
        role: 'assistant',
        content: '',
        kind: 'audio',
        sources: [
          { src: '/ask-bike.opus', type: 'audio/ogg; codecs=opus' },
          { src: '/ask-bike.m4a', type: 'audio/mp4' },
        ],
      },
    ]))
  }, at('bike'))
  await pg.reload()
  await pg.waitForSelector('.choices button', { timeout: 20_000 })
  await pg.waitForSelector('.voice button', { timeout: 20_000 })

  // Started by a real tap, the way a rider starts one.
  await pg.click('.voice button')
  const playing = await settle(async () =>
    pg.evaluate(() => [...document.querySelectorAll('audio')].some((a) => !a.paused)),
    10_000,
  )
  assert.ok(playing, 'nothing was playing to interrupt')

  await pg.click('.choices button')
  await pg.waitForTimeout(800)
  const stillGoing = await pg.evaluate(
    () => [...document.querySelectorAll('audio')].filter((a) => !a.paused).length,
  )
  assert.equal(stillGoing, 0, `a voice note kept playing over the answer (${stillGoing})`)
  await pg.context().close()
})

await check('pressing play on one voice note silences every other', async () => {
  // A rider tapping a second clip while the first is going has no way to stop
  // the first: there is one play button per bubble and no master control.
  await page.goto(APP)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await settle(async () =>
    page.evaluate(() => document.querySelectorAll('.voice audio').length >= 2),
  )
  // Let the welcome finish arriving, so nothing new lands mid-test.
  await settle(async () =>
    page.evaluate(() => {
      const total = JSON.parse(localStorage.getItem('grok-bot:history') || '[]').length
      return total > 0 && document.querySelectorAll('.scroll > *').length === total
    }),
  )
  await page.evaluate(() => {
    // The queue is out of the way; this is about the rider's own taps.
    document.querySelectorAll('audio').forEach((a) => a.pause())
  })

  const playNth = async (n) => {
    await page.evaluate((i) => {
      const btns = [...document.querySelectorAll('.voice button')]
      btns[i]?.click()
    }, n)
    await page.waitForTimeout(700)
  }
  await playNth(0)
  const first = await page.evaluate(() =>
    [...document.querySelectorAll('audio')].filter((a) => !a.paused).length,
  )
  assert.equal(first, 1, `${first} clips playing after one tap`)

  await playNth(1)
  const after = await page.evaluate(() => ({
    playing: [...document.querySelectorAll('audio')].filter((a) => !a.paused).length,
    which: [...document.querySelectorAll('audio')].findIndex((a) => !a.paused),
  }))
  assert.equal(after.playing, 1, `${after.playing} clips playing at once after the second tap`)
  assert.notEqual(after.which, 0, 'the first clip is still the one playing')
})

await check('a returning rider is not read their own history', async () => {
  await page.reload()
  await page.evaluate(() => {
    window.__played = 0
    document.querySelectorAll('audio').forEach((el) =>
      el.addEventListener('play', () => window.__played++),
    )
  })
  await page.waitForTimeout(5000)
  const played = await page.evaluate(() => window.__played)
  assert.equal(played, 0, `${played} clip(s) played themselves on a revisit`)
})

await spoken('the answer is heard before the next question', async () => {
  // The reported bug. A step's question has a recording on disk and is ready at
  // once; the answer has to be read by Uplift first. Queued as they arrived, the
  // rider heard the next question and never heard their answer.
  await primeAt(at('license_front'), [
    { role: 'assistant', content: 'Ab apne driving license ki tasveer bhejein.' },
  ])
  await page.waitForSelector('footer textarea')
  await page.evaluate(() => {
    window.__log = []
    const watch = (el) => {
      if (el.__w) return
      el.__w = true
      el.addEventListener('play', () => window.__log.push(el.currentSrc))
    }
    document.querySelectorAll('audio').forEach(watch)
    new MutationObserver(() => document.querySelectorAll('audio').forEach(watch))
      .observe(document.body, { childList: true, subtree: true })
  })

  await page.fill('footer textarea', `salary kitni milti hai ${Date.now()}`)
  await page.click('footer button.send')

  // Wait until two clips have started, or until we are sure only one will.
  await settle(async () => page.evaluate(() => window.__log.length >= 2), 40_000)
  const log = await page.evaluate(() => window.__log)

  const answer = log.findIndex((u) => u.includes('/api/speak/'))
  const question = log.findIndex((u) => /\/ask-|\/say-/.test(u))
  assert.ok(answer >= 0, `the answer was never played (heard: ${log.join(', ') || 'nothing'})`)
  assert.ok(
    question < 0 || answer < question,
    `the next question was played before the answer (heard: ${log.join(', ')})`,
  )
})

await check('a clip the browser refuses does not pretend to be playing', async () => {
  // A real browser refuses sound until the page is touched, and fires 'play'
  // before refusing — so the bubble showed a pause button over a clip sitting
  // silently at 0:00.
  //
  // Headless Chromium plays regardless of --autoplay-policy, so the refusal
  // cannot be provoked by a flag; asserting against a plain launch only tests
  // that headless plays audio. It is injected instead: play() announces itself
  // and then rejects, exactly as a phone does.
  const strictBrowser = await chromium.launch()
  const strict = await strictBrowser.newContext({ viewport: { width: 390, height: 844 } })
  const page2 = await strict.newPage()
  await page2.addInitScript(() => {
    window.__realPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new Event('play'))
      return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
    }
  })
  await page2.goto(APP)
  await page2.evaluate(() => localStorage.clear())
  await page2.reload()
  await page2.waitForSelector('.voice audio', { state: 'attached', timeout: 20_000 })
  await page2.waitForTimeout(3000)

  const state = await page2.evaluate(() => {
    const a = document.querySelector('.voice audio')
    const btn = document.querySelector('.voice .play')
    return { paused: a.paused, t: a.currentTime, label: btn?.getAttribute('aria-label') }
  })
  assert.ok(state.paused, 'the clip claims to be playing though the browser refused it')
  assert.equal(state.t, 0, `the clip sat at ${state.t}s pretending to have started`)
  assert.equal(
    state.label,
    'Awaaz sunein',
    `the bubble offers "${state.label}" though nothing is playing`,
  )

  // And the rider's first tap should start it for real.
  await page2.evaluate(() => {
    HTMLMediaElement.prototype.play = window.__realPlay
  })
  await page2.click('.voice .play')
  const started = await (async () => {
    for (let i = 0; i < 40; i++) {
      if (
        await page2.evaluate(() => {
          const a = document.querySelector('.voice audio')
          return !a.paused && a.currentTime > 0
        })
      )
        return true
      await page2.waitForTimeout(150)
    }
    return false
  })()
  assert.ok(started, 'tapping play did not start the clip')
  await strictBrowser.close()
})

await browser.close()
console.log(results.join('\n'))
console.log(process.exitCode ? '\n  some browser tests failed' : '\n  all browser tests passed')
