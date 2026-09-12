import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distanceKm, nearestOffice, OFFICES } from '../shared/steps.ts'

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
