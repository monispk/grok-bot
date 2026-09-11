import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asksSomething, readYesNo } from '../shared/steps.ts'

test('reads yes', () => {
  for (const t of ['haan', 'Ji haan', 'jee', 'yes', 'G', 'bilkul', 'ji hai'])
    assert.equal(readYesNo(t), 'yes', t)
})

test('reads no', () => {
  for (const t of ['nahi', 'Nahin', 'no', 'nhi', 'ji nahi', 'nahi hai'])
    assert.equal(readYesNo(t), 'no', t)
})

test('a negative anywhere wins over a positive', () => {
  assert.equal(readYesNo('ji nahi'), 'no')
  assert.equal(readYesNo('haan nahi'), 'no')
})

test('anything unclear is not guessed', () => {
  for (const t of ['kitne paise milenge?', 'Monis Ur Rahmaan', ''])
    assert.equal(readYesNo(t), null, t)
})

test('reads a spoken answer in Urdu script', () => {
  for (const t of ['جی ہاں', 'ہاں', 'بالکل', 'جی'])
    assert.equal(readYesNo(t), 'yes', t)
  for (const t of ['نہیں', 'جی نہیں', 'نہیں ہے'])
    assert.equal(readYesNo(t), 'no', t)
})

test('an Urdu negative still wins over a positive', () => {
  assert.equal(readYesNo('جی نہیں'), 'no')
})

test('a question hidden inside an answer is noticed', () => {
  // Real transcript: the rider answered the smartphone question and asked about
  // pay in the same breath. The pay question was dropped.
  assert.equal(
    asksSomething('haan mere paas hai to sahih magar pehle bataein ke salary kitni mile gi?'),
    true,
  )
  assert.equal(asksSomething('ہاں میرے پاس ہے مگر بتائیں کہ سیلری کتنی ملے گی؟'), true)
  assert.equal(asksSomething('nahi, magar kya main purana phone use kar sakta hoon'), true)
})

test('a plain answer is not mistaken for a question', () => {
  assert.equal(asksSomething('haan'), false)
  assert.equal(asksSomething('ہاں جی میرے پاس ہے'), false)
  assert.equal(asksSomething('haan ji bilkul mere paas touch phone hai'), false)
  assert.equal(asksSomething('nahi mere paas nahi hai'), false)
  // A question mark alone, on a short answer, is not a question.
  assert.equal(asksSomething('haan hai na?'), false)
})
