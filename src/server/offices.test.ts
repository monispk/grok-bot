import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canPickFrom, distanceKm, nearestOffice, OFFICES } from '../shared/steps.ts'

test('the two offices are where the addresses say they are', () => {
  const apart = distanceKm(OFFICES.f8, OFFICES.saddar)
  // Islamabad F-8 to Murree Road, Rawalpindi: a dozen kilometres or so.
  assert.ok(apart > 8 && apart < 20, `the offices are ${apart.toFixed(1)}km apart`)
})

test('a rider is sent to the office they can actually reach', () => {
  // Blue Area, Islamabad — F8 is the near one.
  assert.equal(nearestOffice({ lat: 33.7089, lng: 73.0551 }), 'f8')
  // Committee Chowk, Rawalpindi — Saddar is.
  assert.equal(nearestOffice({ lat: 33.5998, lng: 73.0546 }), 'saddar')
  // Bahria Town, well south — still Saddar.
  assert.equal(nearestOffice({ lat: 33.5040, lng: 73.0980 }), 'saddar')
  // Bani Gala, north-east of the city — F8.
  assert.equal(nearestOffice({ lat: 33.7276, lng: 73.1430 }), 'f8')
})

test('distance is symmetric, and zero at the door', () => {
  assert.equal(distanceKm(OFFICES.f8, OFFICES.f8), 0)
  const a = distanceKm(OFFICES.f8, OFFICES.saddar)
  const b = distanceKm(OFFICES.saddar, OFFICES.f8)
  assert.ok(Math.abs(a - b) < 1e-9)
})

test('a pin is only trusted when it says something useful', () => {
  const blueArea = { lat: 33.7089, lng: 73.0551 }
  assert.ok(canPickFrom({ ...blueArea, accuracy: 20 }), 'a good fix in Islamabad')
  assert.ok(canPickFrom(blueArea), 'no accuracy reported at all')

  // A fix this vague names a city, not an office.
  assert.ok(!canPickFrom({ ...blueArea, accuracy: 5000 }), 'a five-kilometre fix')

  // Lahore. "Nearest" is not a useful word at this range.
  assert.ok(!canPickFrom({ lat: 31.5204, lng: 74.3587, accuracy: 30 }), 'another city')
})

test('a rider far from both offices is told so, not "never mind"', async () => {
  const { whyNotPick } = await import('../shared/steps.ts')
  // Lahore, a good fix: far.
  assert.equal(whyNotPick({ lat: 31.5135, lng: 74.3109, accuracy: 20 }), 'far')
  // Islamabad, but a fix five kilometres wide: vague.
  assert.equal(whyNotPick({ lat: 33.71, lng: 73.05, accuracy: 5000 }), 'vague')
  // Islamabad, a good fix: an office can be chosen.
  assert.equal(whyNotPick({ lat: 33.71, lng: 73.05, accuracy: 20 }), null)
})
