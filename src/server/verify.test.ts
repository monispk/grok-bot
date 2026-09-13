import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspect } from './fields.ts'

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
  // Recorded, not refused: what happens to an expired licence is a policy
  // decision, and this only reports the date on the card.
  assert.ok(r.pass)
})
