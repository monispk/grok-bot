import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCity, knownCity } from '../shared/cities.ts'
import { NO_OFFICE, officeChoice, OFFICE_CITIES } from '../shared/steps.ts'

/**
 * The list exists so that "Pindi", "rwp" and "راولپنڈی" are one city rather
 * than three, and so that the common answers never cost a model call.
 */
test('the ways riders actually write the twin cities all land', () => {
  for (const said of ['Rawalpindi', 'rawalpindi', 'Pindi', 'rwp', 'راولپنڈی', 'main pindi se hoon'])
    assert.equal(knownCity(said), 'Rawalpindi', said)
  for (const said of ['Islamabad', 'isb', 'islamabaad', 'اسلام آباد'])
    assert.equal(knownCity(said), 'Islamabad', said)
})

test('a longer name is not swallowed by a shorter one inside it', () => {
  assert.equal(knownCity('Rahim Yar Khan'), 'Rahim Yar Khan')
  assert.equal(knownCity('Dera Ghazi Khan'), 'Dera Ghazi Khan')
  assert.equal(knownCity('Dera Ismail Khan'), 'Dera Ismail Khan')
})

test('what the list does not know, it does not guess at', () => {
  assert.equal(knownCity('Chak 46 GB'), null)
  assert.equal(knownCity('kya matlab'), null)
  assert.equal(knownCity(''), null)
})

test('every canonical name is one the list will vouch for', () => {
  assert.ok(isCity('Rawalpindi'))
  assert.ok(!isCity('Pindi'))
  assert.ok(!isCity('Delhi'))
})

/**
 * A rider in a city we are in picks between that city's branches. Everyone
 * else is told plainly that we are not in their city — and given a way to say
 * that none of ours will do, rather than being pushed towards one.
 */
test('a rider in an office city is offered that city', () => {
  for (const city of OFFICE_CITIES) {
    const c = officeChoice(city)
    assert.ok(c.offices.length >= 1, city)
    assert.equal(c.wayOut, false, city)
    assert.match(c.say, new RegExp(city))
  }
})

test('a rider anywhere else is told so, and offered a way out', () => {
  const c = officeChoice('Sukkur')
  assert.ok(c.offices.length >= 2)
  assert.equal(c.wayOut, true)
  assert.match(c.say, /Sukkur mein filhaal hamara koi office nahi/)
  assert.equal(NO_OFFICE, 'In mein se koi nahi')
})
