import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  browserSupport,
  chromeIntentUrl,
  classifyMicFailure,
  inAppBrowser,
} from '../client/device.ts'

// Real user agent strings from the browsers riders in Pakistan actually use.
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Infinix X6816C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const UC =
  'Mozilla/5.0 (Linux; U; Android 11; en-US; TECNO KF6n Build/RP1A.200720.011) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/13.6.5.1319 Mobile Safari/537.36'
const OPERA_MINI =
  'Opera/9.80 (Android; Opera Mini/78.0.2254/191.303; U; en) Presto/2.12.423 Version/12.16'
const FACEBOOK =
  'Mozilla/5.0 (Linux; Android 12; V2027) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/447.0.0.35.108;]'
const WEBVIEW =
  'Mozilla/5.0 (Linux; Android 11; itel A662L Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Mobile Safari/537.36'
// WhatsApp opens links in a Chrome custom tab, whose user agent is Chrome's.
const WHATSAPP_TAB = CHROME_ANDROID

const full = { mediaDevices: true, recorder: true }
const none = { mediaDevices: false, recorder: false }

test('Chrome on an ordinary rider phone can record', () => {
  assert.deepEqual(browserSupport(CHROME_ANDROID, full), { ok: true })
  assert.deepEqual(browserSupport(WHATSAPP_TAB, full), { ok: true })
})

test('the browsers that cannot record are named, so the sheet can say what to do', () => {
  // Focus group, phone 1: every tap said "allow the microphone in settings".
  // There was no setting — the browser had no microphone API to allow.
  assert.deepEqual(browserSupport(OPERA_MINI, none), { ok: false, why: 'opera-mini' })
  assert.deepEqual(browserSupport(UC, none), { ok: false, why: 'uc' })
  assert.deepEqual(browserSupport(FACEBOOK, full), { ok: false, why: 'in-app' })
  assert.deepEqual(browserSupport(WEBVIEW, full), { ok: false, why: 'in-app' })
  assert.deepEqual(browserSupport('SomethingOld/1.0', none), { ok: false, why: 'no-api' })
})

test('a UC Browser that does have the API is allowed to try', () => {
  assert.deepEqual(browserSupport(UC, full), { ok: true })
})

test('WhatsApp is not an in-app browser', () => {
  assert.equal(inAppBrowser(WHATSAPP_TAB), false)
  assert.equal(inAppBrowser(FACEBOOK), true)
})

test('each way getUserMedia refuses gets its own name', () => {
  const err = (name: string) => Object.assign(new Error(name), { name })
  assert.equal(classifyMicFailure(err('NotAllowedError')), 'blocked')
  assert.equal(classifyMicFailure(err('NotReadableError')), 'busy')
  assert.equal(classifyMicFailure(err('NotFoundError')), 'none')
  assert.equal(classifyMicFailure(err('TypeError')), 'other')
  assert.equal(classifyMicFailure(null), 'other')
})

test('the Chrome intent carries the page and falls back to the plain link', () => {
  const href = 'https://grok-bot-production-b3a4.up.railway.app/?x=1'
  const url = chromeIntentUrl(href)
  assert.ok(url.startsWith('intent://grok-bot-production-b3a4.up.railway.app/?x=1#Intent;'))
  assert.ok(url.includes('package=com.android.chrome'))
  assert.ok(url.includes(`S.browser_fallback_url=${encodeURIComponent(href)}`))
})
