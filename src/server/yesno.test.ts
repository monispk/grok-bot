import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asksSomething, readPhone, readRail, readYesNo } from '../shared/steps.ts'

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

test('a mobile number survives however the rider writes it', () => {
  // Every one of these is the same number.
  for (const written of [
    '03001234567',
    '0300-1234567',
    '0300 123 4567',
    '+92 300 1234567',
    '923001234567',
    '00923001234567',
    '3001234567',
    'mera number 0300 1234567 hai',
  ])
    assert.equal(readPhone(written), '923001234567', `failed on "${written}"`)
})

test('something that is not a mobile number is refused', () => {
  assert.equal(readPhone('Monis Ur Rahmaan'), null)
  assert.equal(readPhone(''), null)
  assert.equal(readPhone('0421234567'), null)      // a landline, not 03xx
  assert.equal(readPhone('12345'), null)           // too short
  assert.equal(readPhone('61101-1234567-1'), null) // a CNIC, not a phone
})

test('the shortest answers a phone keyboard offers', () => {
  // Reported: "y" was not understood, so the model was asked to answer a
  // question nobody had asked, and it invented one.
  for (const yes of ['y', 'Y', 'yes', 'ok', 'theek hai', 'haan']) assert.equal(readYesNo(yes), 'yes', yes)
  for (const no of ['n', 'N', 'no', 'nahi']) assert.equal(readYesNo(no), 'no', no)
})

test('which wallet, however the rider says it', () => {
  for (const said of ['easypaisa', 'Easy Paisa', 'ep', 'easypaisa hai'])
    assert.equal(readRail(said), 'easypaisa', said)
  for (const said of ['jazzcash', 'jazz cash', 'JazzCash hai', 'jazz'])
    assert.equal(readRail(said), 'jazzcash', said)
  for (const said of ['koi nahi', 'nahi', 'dono nahi hain', 'neither', 'کوئی نہیں'])
    assert.equal(readRail(said), 'neither', said)
  assert.equal(readRail('pata nahin kya'), 'neither')  // any "nahi" is a no
  assert.equal(readRail('hmm'), null)
})
