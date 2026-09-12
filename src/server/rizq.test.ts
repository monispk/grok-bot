import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localNumber, titleMatches } from './rizq.ts'

test('the number is sent in the form Rizq expects', () => {
  assert.equal(localNumber('923001234567'), '03001234567')
  assert.equal(localNumber('03001234567'), '03001234567')
})

test('an abbreviated wallet title still belongs to its owner', () => {
  // Wallet titles are shortened and inconsistently spelled. None of these is a
  // different person, and flagging them would waste a recruiter's afternoon.
  for (const title of ['MONIS UR RAHMAAN', 'Monis Ur Rahman', 'M U RAHMAN', 'M UR RAHMAAN'])
    assert.ok(titleMatches('Monis Ur Rahmaan', title), `rejected "${title}"`)
})

test('somebody else’s wallet does not match', () => {
  for (const title of ['Ali Hassan', 'A HASSAN', 'Fatima Bibi', ''])
    assert.ok(!titleMatches('Monis Ur Rahmaan', title), `accepted "${title}"`)
})

test('initials alone are not a name', () => {
  // "M U R" could be almost anyone; the surname has to be spelled out.
  assert.ok(!titleMatches('Monis Ur Rahmaan', 'M U R'))
})

test('a counter clerk running the name together is still the same person', () => {
  // Real: this rider's Easypaisa title is "MONASUR REHMAN" and their JazzCash
  // title is "MONIS UR RAHMAN". One person, two counters, two spellings.
  const cnic = 'Monis Ur Rahmaan'
  for (const title of ['MONIS UR RAHMAN', 'MONASUR REHMAN', 'MONIS RAHMAN', 'M U RAHMAN'])
    assert.ok(titleMatches(cnic, title), `rejected "${title}"`)
})

test('a near-miss is still not anybody else', () => {
  const cnic = 'Monis Ur Rahmaan'
  for (const title of ['Ali Hassan', 'A HASSAN', 'Fatima Bibi', 'M U R', ''])
    assert.ok(!titleMatches(cnic, title), `accepted "${title}"`)
})
