import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ingestBody } from './ingest.ts'

const ID = '11111111-2222-4333-8444-555555555555'

const rider = (over: Record<string, unknown> = {}) => ({
  step: 9,
  firstName: 'Monis',
  fullName: 'Monis Ur Rahmaan',
  phone: '923348234444',
  cnic: '3520201427267',
  rail: 'jazzcash',
  branch: 'f8',
  missing: [],
  collected: {
    'license.number': 'LE-24-123386',
    'license.expiry': '2030-05-12',
    'license.expired': 'false',
    'license.readBy': 'local OCR + vision',
    'cnic_front.name': 'MONIS UR RAHMAN',
    'cnic_front.cnic': '3520201427267',
    'checks.faceMatch': 'match (99.0)',
    'checks.licenceVsCnic': 'match',
    'checks.wallet': 'match — MONIS UR RAHMAN (jazzcash)',
    'gps.latitude': '33.712500',
    'gps.longitude': '73.037300',
    'gps.office': 'F8 Markaz, Islamabad',
  },
  payment: { rail: 'jazzcash', state: 'paid', amountPaisa: 250000, ref: 'RzB2026', detail: 'ok' },
  ...over,
})

/**
 * Their dashboard finds a candidate by the number on their card, and it looks
 * for it in exactly one place. Anywhere else and the rider cannot be found.
 */
test('the CNIC goes where their dashboard searches for it', () => {
  const b = ingestBody(ID, rider(), [])
  const identity = b.validation_results!['identity_verification'] as {
    passed: boolean
    detail: Record<string, unknown>
  }
  assert.equal(identity.detail['front_cnic'], '3520201427267')
  assert.equal(identity.passed, true)
})

/**
 * A gate answered "no" is recorded as the step's name in `missing`; answered
 * "yes" is recorded as nothing at all. So the only way to tell a yes from a
 * question not yet asked is how far through the rider is.
 */
test('a yes and a not-yet-asked are not the same answer', () => {
  assert.equal(ingestBody(ID, rider(), []).collected!['bike'], 'haan')
  assert.equal(ingestBody(ID, rider({ missing: ['bike'] }), []).collected!['bike'], 'nahi')
  // Two steps in: neither gate has been reached, so neither has an answer.
  const early = ingestBody(ID, rider({ step: 2, missing: [] }), [])
  assert.equal(early.collected!['bike'], undefined)
  assert.equal(early.collected!['smartphone'], undefined)
})

test('the phase follows where the rider actually is', () => {
  assert.equal(ingestBody(ID, rider({ step: 2 }), []).phase, 'collecting')
  assert.equal(ingestBody(ID, rider({ step: 6 }), []).phase, 'validating')
  assert.equal(ingestBody(ID, rider({ step: 9 }), []).phase, 'complete')
  // Screened out is finished, whatever step they stopped on.
  assert.equal(ingestBody(ID, rider({ step: 3, ineligible: true }), []).phase, 'complete')
})

test('an expired licence fails its check without stopping the application', () => {
  const b = ingestBody(
    ID,
    rider({ collected: { ...rider().collected, 'license.expired': 'true' } }),
    [],
  )
  const licence = b.validation_results!['licence'] as { passed: boolean; detail: Record<string, unknown> }
  assert.equal(licence.passed, false)
  assert.equal(licence.detail['expired'], true)
})

test('the fee reports what the rail actually did', () => {
  const fee = ingestBody(ID, rider(), []).validation_results!['fee'] as {
    passed: boolean
    detail: Record<string, unknown>
  }
  assert.equal(fee.passed, true)
  assert.equal(fee.detail['amount_paisa'], 250000)
  assert.equal(ingestBody(ID, rider(), []).fee_order_id, 'RzB2026')
})

test('where the rider is, in the fields their map reads', () => {
  const b = ingestBody(ID, rider(), [])
  assert.equal(b.candidate_lat, 33.7125)
  assert.equal(b.candidate_lng, 73.0373)
  assert.equal(b.candidate_city, 'Islamabad')
  assert.equal(ingestBody(ID, rider({ branch: 'saddar' }), []).candidate_city, 'Rawalpindi')
})

test('an application with nothing in it sends nothing but its phase', () => {
  const b = ingestBody(ID, { step: 0, collected: {} }, [])
  assert.equal(b.phase, 'collecting')
  assert.deepEqual(b.collected, {})
  assert.equal(b.validation_results, undefined)
  assert.equal(b.messages, undefined)
})

test('the conversation rides along, with the voice notes in it', () => {
  process.env.APP_URL = 'https://rozeena.test'
  const b = ingestBody(ID, rider(), [
    { role: 'assistant', content: 'Aapka poora naam?', at: 1 },
    {
      role: 'user',
      content: 'Monis Ur Rahmaan',
      kind: 'audio',
      at: 2,
      src: '/api/upload/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    },
  ])
  assert.equal(b.messages?.length, 2)
  assert.equal(b.messages![1]!.type, 'voice')
  assert.match(b.messages![1]!.audio_url ?? '', /^https:\/\/rozeena\.test\/api\/upload\//)
  delete process.env.APP_URL
})
