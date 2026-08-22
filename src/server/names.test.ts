import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareNames, normalise } from './names.ts'

const v = (a: string, b: string) => compareNames(a, b).verdict

test('identical names match', () => {
  assert.equal(v('Muhammad Bilal Ahmed', 'Muhammad Bilal Ahmed'), 'match')
})

test('transliteration variants match', () => {
  assert.equal(v('Mohd Bilal Ahmad', 'Muhammad Bilal Ahmed'), 'match')
  assert.equal(v('Mohammed Bilal Ahmed', 'MUHAMMAD BILAL AHMED'), 'match')
  assert.equal(v('Aisha Khan', 'Ayesha Khan'), 'match')
  assert.equal(v('Abdul Rehman Sheikh', 'Abdel Rahman Shaikh'), 'match')
})

test('a shortened name still matches', () => {
  assert.equal(v('Muhammad Bilal', 'Muhammad Bilal Ahmed'), 'match')
  assert.equal(v('Bilal Ahmed', 'Bilal Ahmed Khan'), 'match')
})

test('OCR noise is absorbed', () => {
  assert.equal(v('Muhammad Bilaal Ahmed', 'Muhammad Bilal Ahmed'), 'match')
  assert.equal(v('MUHAMMAD  BILAL   AHMED.', 'Muhammad Bilal Ahmed'), 'match')
})

test('relationship markers are stripped', () => {
  assert.deepEqual(normalise('Bilal Ahmed S/O Muhammad Aslam'), [
    'bilal', 'ahmed', 'muhammad', 'aslam',
  ])
})

test('sharing only Muhammad is not a match', () => {
  assert.equal(v('Muhammad Ali', 'Muhammad Bilal'), 'mismatch')
  assert.equal(v('Muhammad', 'Muhammad Bilal Ahmed'), 'review')
})

test('a single common token is never a match', () => {
  assert.equal(v('Bilal', 'Muhammad Bilal Ahmed'), 'review')
})

test('different people do not match', () => {
  assert.equal(v('Ayesha Khan', 'Muhammad Bilal Ahmed'), 'mismatch')
  assert.equal(v('Imran Yousaf', 'Bilal Ahmed'), 'mismatch')
})

// Shapes taken from real OCR output on a Punjab licence and a CNIC, with the
// names replaced — these documents are real people's ID and this repo is public.
test('OCR that loses the spaces inside a name still matches', () => {
  assert.equal(v('Kamran Ur Rasheed', 'KAMRANURRASHEED'), 'match')
  assert.equal(v('Kamran Ur Rasheed', 'KAMRAN UR RASHEED'), 'match')
  assert.equal(v('Nadia Ur Rasheed', 'NADIAURRASHID'), 'match')
  assert.equal(v('Bilal Ahmed', 'BILALAHMAD'), 'match')
})

test('despacing does not make different names match', () => {
  assert.equal(v('Muhammad Ali', 'MUHAMMADBILAL'), 'mismatch')
  assert.equal(v('Imran Yousaf', 'IMRANKHAN'), 'mismatch')
  assert.equal(v('Sana Iqbal', 'SANAJAMIL'), 'mismatch')
})

test('names that sound alike but are spelled differently match', () => {
  assert.equal(v('Naveed Iqbal', 'Naweed Iqbal'), 'match')       // v / w
  assert.equal(v('Faruqi Sahib Khan', 'Faruki Sahib Khan'), 'match') // q / k
  assert.equal(v('Kamran Ur Rasheed', 'Kamran Ur Rashid'), 'match')  // ee / i
  assert.equal(v('Asif Mehmood', 'Asif Mehmud'), 'match')            // oo / u
})

test('sounding similar is not enough when the name is genuinely different', () => {
  assert.equal(v('Asif Mehmood', 'Arif Mehmood'), 'review')
  assert.equal(v('Sana Iqbal', 'Sana Jamil'), 'mismatch')
})

test('empty input is a mismatch, not a crash', () => {
  assert.equal(v('', 'Muhammad Bilal'), 'mismatch')
  assert.equal(v('   ', ''), 'mismatch')
})
