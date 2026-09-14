import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspect } from './fields.ts'
import { blockedOn, farewellLines, inviteLines } from '../shared/steps.ts'

/**
 * The reading of a real Punjab licence, as the local OCR produced it twice out
 * of three uploads of the same card — and, the third time, without the expiry.
 */
const CARD = [
  'DRIVING LICENSE', 'TRAFFIC POLICE, PUNJAB',
  'License No.  2003/20002', 'Name  MONIS UR RAHMAN',
  'Issue Date  12-MAY-20', 'Expiry Date  12-MAY-30',
  'CNIC No.  35202-0142726-7', 'Date of Birth  08-MAY-70',
]

test('a licence reads its expiry when the label survives', () => {
  const r = inspect('license', { lines: CARD, words: [] })
  assert.ok(r.pass)
  assert.equal(r.fields.expiry, '2030-05-12')
  assert.equal(r.fields.expired, 'false')
})

test('a licence still passes when the expiry is lost, and says it is missing', () => {
  // This is the case vision is called for: everything else read, and the one
  // field that decides whether the licence is any use did not.
  const withoutDates = CARD.filter((l) => !/Expiry Date/.test(l))
  const r = inspect('license', { lines: withoutDates, words: [] })
  assert.ok(r.pass, `refused: ${r.missing.join(', ')}`)
  assert.equal(r.fields.expiry, null)
  assert.equal(r.fields.expired, null)
  assert.equal(r.fields.number, '2003/20002')
})

test('an expiry in the past is recorded as expired', () => {
  const old = CARD.map((l) => l.replace('Expiry Date  12-MAY-30', 'Expiry Date  12-MAY-21'))
  const r = inspect('license', { lines: old, words: [] })
  assert.equal(r.fields.expiry, '2021-05-12')
  assert.equal(r.fields.expired, 'true')
  // Recorded, not refused: a re-upload cannot renew a card. What it costs the
  // rider is the verified outcome, not the upload — see the two tests below.
  assert.ok(r.pass)
})

/**
 * What an expired licence costs the rider.
 *
 * Not the upload: another photograph of the same card cannot renew it, so
 * refusing it would only loop. What it costs is the fee — an application with
 * a licence that has run out is not a verified one, so nothing is charged and
 * the rider is sent to the office once the card is renewed.
 */
test('an expired licence is named among the things the rider is waiting for', () => {
  assert.equal(blockedOn([], { licenceExpired: true }), 'naya license')
  assert.equal(blockedOn(['bike'], { licenceExpired: true }), 'apni bike aur naya license')
  assert.equal(blockedOn(['bike', 'smartphone'], { licenceExpired: true }), 'apni bike, touch phone aur naya license')
  // Unchanged for everybody else.
  assert.equal(blockedOn([], { licenceExpired: false }), null)
  assert.equal(blockedOn(['bike', 'smartphone']), 'apni bike aur touch phone')
})

test('an expired licence is asked for by name at the office, alongside the CNIC', () => {
  const lines = inviteLines('F8 Markaz', {
    owesFee: true,
    licenceExpired: true,
    waitingFor: blockedOn([], { licenceExpired: true }),
  })
  assert.match(lines[0]!, /naya license/)
  assert.match(lines.join('\n'), /CNIC aur apna naya license saath laayein/)
  // The fee is still owed; it is taken at the counter, not in the chat.
  assert.match(lines.join('\n'), /counter par jama karayein/)

  const ordinary = inviteLines('F8 Markaz', { owesFee: true })
  assert.match(ordinary.join('\n'), /Apna asli CNIC saath laayein/)
  assert.doesNotMatch(ordinary.join('\n'), /license/)
})

/**
 * A card the reader could not be sure of after two photographs. Nothing is
 * claimed about it — not that it expired, not that it did not — and the rider
 * is asked to carry the card itself, which settles the question in a second.
 */
test('a licence that could not be read is asked for at the office', () => {
  const lines = inviteLines('F8 Markaz', { owesFee: false, licenceUnread: true })
  assert.match(lines.join('\n'), /CNIC aur apna asli driving license saath laayein/)
  assert.doesNotMatch(lines.join('\n'), /counter par jama karayein/)
  assert.match(farewellLines({ owesFee: false, licenceUnread: true }).join('\n'), /asli driving license/)
})
