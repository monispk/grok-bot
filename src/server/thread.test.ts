import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asMessages, entry, type Entry } from './thread.ts'

const VOICE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const DOC = 'ffffffff-1111-4222-8333-444444444444'

/**
 * A thread exactly as the web app stores it, taken from a real conversation.
 * If the app's shape drifts, this is what should notice.
 */
const HISTORY = [
  { role: 'assistant', content: 'Chalain shuru kartay hain! Aapka poora naam kya hai?', at: 1 },
  {
    role: 'assistant',
    content: '',
    kind: 'audio',
    at: 2,
    sources: [
      { src: '/ask-full_name.opus', type: 'audio/ogg; codecs=opus' },
      { src: '/ask-full_name.m4a', type: 'audio/mp4' },
    ],
  },
  { role: 'user', content: 'Monis ur Rahman', at: 3 },
  {
    role: 'user',
    content: 'mere paas bike hai',
    kind: 'audio',
    at: 4,
    src: `/api/upload/${VOICE}`,
    sources: [{ src: `/api/upload/${VOICE}`, type: 'audio/webm' }],
  },
  { role: 'user', content: 'Motorcycle', kind: 'choice', at: 5, src: '/bike.png' },
  {
    role: 'user',
    content: '',
    kind: 'document',
    at: 6,
    src: `/api/upload/${DOC}`,
    doc: { name: 'licence.jpg', mime: 'image/jpeg', size: 204800 },
  },
  { role: 'assistant', content: '', kind: 'video', video: 'pofJtK4o2z4', at: 7 },
  {
    role: 'assistant',
    content: 'F8 Markaz, Islamabad',
    kind: 'location',
    at: 8,
    src: '/office-f8.jpg',
    place: { lat: 33.7125, lng: 73.0373, address: 'foodpanda office, F8 Markaz' },
  },
]

const of = (type: string) => asMessages(HISTORY).find((m: Entry) => m.type === type)!

test('the thread comes back in order, with both sides in it', () => {
  assert.deepEqual(
    asMessages(HISTORY).map((m: Entry) => `${m.role}:${m.type}`),
    [
      'assistant:text',
      'assistant:audio',
      'user:text',
      'user:voice',
      'user:choice',
      'user:document',
      'assistant:video',
      'assistant:location',
    ],
  )
  // Their API wants ISO, not the milliseconds a browser counts in.
  assert.equal(asMessages(HISTORY)[0]!.at, new Date(1).toISOString())
})

/**
 * The voice note is the point of all this. Their document endpoint takes
 * images and PDFs only, so the recording travels as a link and the transcript
 * as the words — a chat log that can be read, and played.
 */
test('a voice note carries its words and a link to the recording', () => {
  process.env.APP_URL = 'https://rozeena.test'
  const voice = of('voice')
  assert.equal(voice.role, 'user')
  assert.equal(voice.content, 'mere paas bike hai')
  assert.equal(voice.audio_url, `https://rozeena.test/api/upload/${VOICE}`)
  delete process.env.APP_URL
})

test('with nowhere to fetch from, a voice note still carries its words', () => {
  delete process.env.APP_URL
  delete process.env.RAILWAY_PUBLIC_DOMAIN
  const voice = of('voice')
  assert.equal(voice.audio_url, undefined)
  assert.equal(voice.content, 'mere paas bike hai')
})

test('a clip that was never stored keeps its words and offers no link', () => {
  const e = entry({
    role: 'user',
    content: 'haan ji',
    kind: 'audio',
    sources: [{ src: 'blob:http://x/y', type: 'audio/webm' }],
  })!
  assert.equal(e.type, 'voice')
  assert.equal(e.audio_url, undefined)
  assert.equal(e.content, 'haan ji')
})

test('a document says which one it was, so it lines up with the file', () => {
  assert.equal(of('document').kind, 'license')
  assert.equal(of('document').content, 'licence.jpg')
})

test('an empty bubble is not a message', () => {
  assert.equal(entry({ role: 'assistant', content: '' }), null)
  assert.equal(entry({ role: 'assistant', content: '   ' }), null)
})

test('what Rozeena said aloud is named by its recording, not by a URL', () => {
  assert.equal(of('audio').clip, 'ask-full_name')
  assert.equal(of('audio').role, 'assistant')
})

test('the office pin keeps its coordinates', () => {
  assert.equal(of('location').place?.lat, 33.7125)
  assert.equal(of('location').content, 'F8 Markaz, Islamabad')
})

test('reading the same thread twice produces the same messages', () => {
  assert.equal(JSON.stringify(asMessages(HISTORY)), JSON.stringify(asMessages(HISTORY)))
})
