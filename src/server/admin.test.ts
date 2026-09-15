import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bubble, faceMatch, uploaded } from './admin.ts'
import { MIN_SIMILARITY } from './rozee.ts'

/**
 * The admin thread is the record of an application.
 *
 * It used to render every attachment as the word "[audio]" or "[document]" —
 * which said that something had been sent, and nothing about what. These tests
 * hold the two things a recruiter actually needs from it: the picture the
 * rider sent, and the rider's own voice rather than only our transcript of it.
 */

test('a rider’s voice note is playable, with the transcript under it', () => {
  const html = bubble({
    role: 'user',
    kind: 'audio',
    content: 'mere paas bike hai',
    src: '/api/upload/abc',
    sources: [{ src: '/api/upload/abc', type: 'audio/webm' }],
  })
  assert.match(html, /<audio controls/)
  assert.match(html, /<source src="\/api\/upload\/abc" type="audio\/webm">/)
  assert.match(html, /mere paas bike hai/)
  assert.match(html, /class="msg me"/)
})

test('what Rozeena said is playable too, from whichever file the browser takes', () => {
  const html = bubble({
    role: 'assistant',
    kind: 'audio',
    content: '',
    sources: [
      { src: '/say-not-license.opus', type: 'audio/ogg; codecs=opus' },
      { src: '/say-not-license.m4a', type: 'audio/mp4' },
    ],
  })
  assert.match(html, /class="msg bot"/)
  assert.equal(html.match(/<source /g)?.length, 2)
})

test('a clip that outlived its retention keeps its words and loses its player', () => {
  const html = bubble({ role: 'user', kind: 'audio', content: 'jee bilkul' })
  assert.doesNotMatch(html, /<audio/)
  assert.match(html, /jee bilkul/)
})

test('a blob URL is never rendered — it died with the rider’s page', () => {
  const html = bubble({
    role: 'user',
    kind: 'audio',
    content: 'haan',
    sources: [{ src: 'blob:http://x/y', type: 'audio/webm' }],
  })
  assert.doesNotMatch(html, /<audio/)
  assert.doesNotMatch(html, /blob:/)
})

test('the document the rider sent is shown, and opens full size', () => {
  const html = bubble({
    role: 'user',
    kind: 'document',
    content: '',
    src: '/api/upload/xyz',
    doc: { name: 'licence.jpg', mime: 'image/jpeg', size: 204800 },
  })
  assert.match(html, /<img src="\/api\/upload\/xyz"/)
  assert.match(html, /href="\/api\/upload\/xyz"/)
  assert.match(html, /licence\.jpg · 200 KB/)
})

test('a PDF is offered as a link rather than a broken image', () => {
  const html = bubble({
    role: 'user',
    kind: 'document',
    content: '',
    src: '/api/upload/pdf1',
    doc: { name: 'bill.pdf', mime: 'application/pdf', size: 1024 },
  })
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /href="\/api\/upload\/pdf1"/)
})

test('the office pin keeps its map and points at the real coordinates', () => {
  const html = bubble({
    role: 'assistant',
    kind: 'location',
    content: 'F8 Markaz, Islamabad',
    src: '/office-f8.jpg',
    place: { lat: 33.7125, lng: 73.0373, address: 'foodpanda office, F8 Markaz' },
  })
  assert.match(html, /33\.7125,73\.0373/)
  assert.match(html, /office-f8\.jpg/)
  assert.match(html, /foodpanda office, F8 Markaz/)
})

test('words are escaped, wherever they came from', () => {
  const html = bubble({ role: 'user', content: '<script>alert(1)</script>' })
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('every uploaded document is listed, in the order they are asked for', () => {
  const found = uploaded({
    'selfie.uploadId': 's1',
    'cnic_front.uploadId': 'c1',
    'license.uploadId': 'l1',
    'bill.uploadId': 'b1',
    'license.expiry': '2030-05-12',
  })
  assert.deepEqual(
    found.map((d) => d.kind),
    ['license', 'cnic_front', 'bill', 'selfie'],
  )
})

test('a document kind nobody has listed yet is still shown', () => {
  const found = uploaded({ 'vehicle_book.uploadId': 'v1', 'license.uploadId': 'l1' })
  assert.deepEqual(
    found.map((d) => d.kind),
    ['license', 'vehicle_book'],
  )
})

/**
 * The face check is the criterion a rider is verified by, and the number
 * behind it decides the answer — so a recruiter sees the number, not a tick.
 */
test('the face match is reported with its score and the bar it had to clear', () => {
  assert.equal(faceMatch('match (99.0)'), 'matched — 99.0 of 100')
  assert.equal(faceMatch(`match (${MIN_SIMILARITY}.0)`), `matched — ${MIN_SIMILARITY}.0 of 100`)
  assert.equal(
    faceMatch('mismatch (41.2)'),
    `no match — 41.2 of 100, below ${MIN_SIMILARITY}`,
  )
})

test('a check that never ran says so, rather than reading as a failure', () => {
  assert.equal(faceMatch(undefined), 'not run')
  assert.equal(faceMatch('not checked'), 'not checked')
})
