import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockedOn, saysHasnt } from '../shared/steps.ts'

/**
 * A rider with no driving licence said so three times — twice by voice, once
 * in English — and each time was handed the same line about pressing the
 * camera button. These are the words Whisper actually produced, from the
 * screenshot of that conversation.
 */
test('the rider who said it three times is heard every time', () => {
  assert.ok(saysHasnt('میرے پاس تو driving license نہیں ہے'))
  assert.ok(saysHasnt('میرے پاس ڈرائیورز لیسنز ہے ہی نہیں ہے'))
  assert.ok(saysHasnt("I don't have a driving license"))
})

test('the shorthand a rider actually types is heard too', () => {
  for (const said of [
    'nahi hai',
    'nhn hai',
    'mere paas license nahi hai',
    'mere pas nahi h',
    'license nahi hai mere paas',
    'no license',
    'i do not have one',
    'dont have',
    'abhi nahi bana',
  ])
    assert.ok(saysHasnt(said), said)
})

/**
 * The negative alone is never enough. A rider who did not understand the
 * question, or who is asking one, has not told us they have no licence — and
 * being recorded as having none would cost them the fee path and send them to
 * an office for a document they are holding.
 */
test('not understanding is not the same as not having', () => {
  for (const said of [
    'samajh nahi aaya',
    'pata nhi',
    'ye kya hai mujhe maloom nahi',
  ])
    assert.equal(saysHasnt(said), false, said)
})

test('a question about the licence is not a rider without one', () => {
  for (const said of [
    'license ki tasveer kaise bhejun',
    'kya mujhe license chahiye',
    'salary kitni milti hai',
    'bhej diya hai',
  ])
    assert.equal(saysHasnt(said), false, said)
})

test('what the rider is asked to bring names the document they lack', () => {
  assert.equal(blockedOn(['license_front']), 'apna driving license')
  assert.equal(blockedOn(['cnic_front']), 'apna CNIC')
  assert.equal(
    blockedOn(['bike', 'license_front']),
    'apni bike aur apna driving license',
  )
  // A licence they do not have and an expiry read from one they never sent
  // cannot both be true. The missing card wins; it is the one they know about.
  assert.equal(blockedOn(['license_front'], { licenceExpired: true }), 'apna driving license')
  assert.equal(blockedOn([], { licenceExpired: true }), 'naya license')
})
