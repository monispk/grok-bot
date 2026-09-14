import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isoDate, shapeOpenAi } from './vision-openai.ts'

/**
 * Their schema returns dates as the card prints them and an empty string for
 * anything it could not read. Both of those have to survive the trip into the
 * shape the rest of this code expects, because the whole point of the third
 * reader is the cards where the other two guessed.
 */
test('a printed date becomes the date the rest of the code uses', () => {
  assert.equal(isoDate('07.09.2027'), '2027-09-07')
  assert.equal(isoDate('7.9.2027'), '2027-09-07')
  assert.equal(isoDate('07-09-2027'), '2027-09-07')
})

test('a date that is not one is not invented', () => {
  assert.equal(isoDate(''), null)
  assert.equal(isoDate('31.02.2027'), null)
  assert.equal(isoDate('September 2027'), null)
  assert.equal(isoDate('2027-09-07'), null)
})

test('a full reading comes through intact', () => {
  const r = shapeOpenAi({
    is_driving_license: true,
    unreadable: false,
    holder_name: 'MONIS UR RAHMAN',
    license_number: 'LE-24-123386',
    cnic_number: '3520201427267',
    expiry_date: '07.09.2027',
    issue_date: '08.09.2022',
    is_learner_permit: false,
  })
  assert.equal(r.isLicence, true)
  assert.equal(r.name, 'MONIS UR RAHMAN')
  assert.equal(r.number, 'LE-24-123386')
  assert.equal(r.cnic, '3520201427267')
  assert.equal(r.expiry, '2027-09-07')
  assert.equal(r.readable, true)
})

/**
 * Empty means "could not read it", and must never become a claim. A blank
 * expiry that arrived as "expired" would refuse a rider on nothing at all.
 */
test('what it could not read stays unread', () => {
  const r = shapeOpenAi({
    is_driving_license: true,
    unreadable: false,
    holder_name: '',
    license_number: 'LE-24-123386',
    cnic_number: '',
    expiry_date: '',
    issue_date: '',
    is_learner_permit: false,
  })
  assert.equal(r.name, null)
  assert.equal(r.expiry, null)
  assert.equal(r.cnic, null)
  assert.equal(r.number, 'LE-24-123386')
})

test('a CNIC that is not thirteen digits is not a CNIC', () => {
  const short = shapeOpenAi({ is_driving_license: true, cnic_number: '35202014' })
  assert.equal(short.cnic, null)
  const dashed = shapeOpenAi({ is_driving_license: true, cnic_number: '35202-0142726-7' })
  assert.equal(dashed.cnic, '3520201427267')
})

test('something that is not a licence says so', () => {
  const r = shapeOpenAi({ is_driving_license: false, unreadable: false, holder_name: 'X' })
  assert.equal(r.isLicence, false)
})

test('a licence too poor to read is marked, not emptied', () => {
  const r = shapeOpenAi({ is_driving_license: true, unreadable: true, license_number: '' })
  assert.equal(r.isLicence, true)
  assert.equal(r.readable, false)
})
