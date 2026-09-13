import assert from 'node:assert/strict'
import { test } from 'node:test'
import { delta, flatten, forBackend } from './push.ts'

test('an application flattens to fields that can be tracked one at a time', () => {
  const flat = flatten({
    fullName: 'Monis Ur Rahmaan',
    payment: { state: 'paid', amountPaisa: 200 },
    collected: { 'license.name': 'MONIS UR RAHMAN' },
    missing: ['bike'],
  })
  assert.equal(flat['fullName'], 'Monis Ur Rahmaan')
  assert.equal(flat['payment.state'], 'paid')
  assert.equal(flat['collected.license.name'], 'MONIS UR RAHMAN')
  // An array is one value: half a list is not a fact about anything.
  assert.deepEqual(flat['missing'], ['bike'])
})

test('only what the backend has not acknowledged is sent again', () => {
  const now = { fullName: 'Monis', 'payment.state': 'paid', phone: '923348234444' }
  const sent = { fullName: 'Monis', 'payment.state': 'pending' }
  assert.deepEqual(delta(now, sent), { 'payment.state': 'paid', phone: '923348234444' })
  // Nothing changed means nothing queued, however often it is saved.
  assert.deepEqual(delta(sent, sent), {})
})

test('what is ours stays ours', () => {
  // Working state that means nothing outside this app, and an id the backend
  // already has from the URL.
  const flat = forBackend({
    applicationId: 'a-b-c',
    fullName: 'Monis',
    resume: { id: 'x', firstName: 'M', step: 3 },
    sentBranch: true,
    payRetried: true,
    payment: { state: 'paid' },
  })
  assert.deepEqual(Object.keys(flat).sort(), ['fullName', 'payment.state'])
})
