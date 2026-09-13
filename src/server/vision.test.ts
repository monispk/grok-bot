import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shape } from './vision.ts'

test('only what a card can actually have said survives', () => {
  const r = shape({
    is_licence: true,
    authority: 'Traffic Police, Sindh',
    name: 'ALTAF HUSSAIN',
    number: 'SI-24-556677',
    cnic: '42201-1234567-8',
    expiry: '2029-03-14',
    readable: true,
    // A model's stray invention is not carried through.
    blood_group: 'O+',
  })
  assert.deepEqual(r, {
    isLicence: true,
    authority: 'Traffic Police, Sindh',
    name: 'ALTAF HUSSAIN',
    number: 'SI-24-556677',
    cnic: '422011234567 8'.replace(/\D/g, ''),
    expiry: '2029-03-14',
    readable: true,
  })
})

test('a half-read field is no field at all', () => {
  // A partial CNIC would fail the comparison against the card for a reason
  // nobody could trace, so it is dropped rather than passed on.
  assert.equal(shape({ is_licence: true, cnic: '35202-276' }).cnic, null)
  assert.equal(shape({ is_licence: true, cnic: '3520227626587' }).cnic, '3520227626587')
  // Dates only in the form the rest of the pipeline understands.
  assert.equal(shape({ is_licence: true, expiry: '07-SEP-27' }).expiry, null)
  assert.equal(shape({ is_licence: true, expiry: '2027-09-07' }).expiry, '2027-09-07')
  // The words a model reaches for when it has nothing.
  assert.equal(shape({ is_licence: true, name: 'null' }).name, null)
  assert.equal(shape({ is_licence: true, name: 'N/A' }).name, null)
  assert.equal(shape({ is_licence: true, name: '  ' }).name, null)
})

test('anything short of a plain yes is not a licence', () => {
  assert.equal(shape({ is_licence: false, name: 'ALTAF HUSSAIN' }).isLicence, false)
  assert.equal(shape({ is_licence: 'true' }).isLicence, false)
  assert.equal(shape({}).isLicence, false)
  // Readability is assumed unless the model says otherwise.
  assert.equal(shape({ is_licence: true }).readable, true)
  assert.equal(shape({ is_licence: true, readable: false }).readable, false)
})
