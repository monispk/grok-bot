import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBank } from './bank.ts'
import { titleMatches } from './rizq.ts'

/**
 * A rider types a bank's name from memory, on a phone keyboard, in a language
 * whose spellings were never standardised in Latin script. A list that only
 * takes exact spellings turns every one of these into "we cannot check that
 * bank" — which costs the rider a verification they would have passed.
 */
test('a bank is recognised through the spellings riders actually use', async () => {
  const cases: [string, string][] = [
    ['meezn', '59'],
    ['mezan bank', '59'],
    ['Meezan', '59'],
    ['alfalh', '9'],
    ['bank alfala', '9'],
    ['askri bank', '55'],
    ['faysel', '21'],
    ['standerd chartered', '49'],
    ['soneri bnk', '41'],
    ['sindh bank', '39'],
    ['dubai islamic', '19'],
    ['jazcash', '33'],
    ['easy paisa', '51'],
  ]
  for (const [said, id] of cases) {
    const got = await readBank(said)
    assert.equal(got.id, id, `${said} -> ${got.id} (${got.by})`)
  }
})

test('a near-miss that fits two banks is still a question', async () => {
  const got = await readBank('habib')
  assert.equal(got.id, null)
  assert.equal(got.unsure, true)
})

/**
 * The title a bank returns is not the name on the CNIC, and never was. It is
 * abbreviated, transliterated by whoever was at the counter, and sometimes
 * missing a whole name from the middle. Refusing those is refusing real
 * riders, so the comparison is phonetic and near-miss, and a single letter is
 * allowed to stand for the name it begins.
 */
test('a bank title matches the CNIC name through ordinary variation', () => {
  const cnic = 'Monis Ur Rahmaan'
  for (const title of [
    'MONIS UR RAHMAN',      // the spelling the bank chose
    'MONAS UR REHMAN',      // what Easypaisa actually returned for this rider
    'M U RAHMAN',           // initials, surname spelled out
    'MONIS RAHMAN',         // the middle name dropped
    'MONASUR REHMAN',       // a counter clerk running two words together
    'monis ur rahmaan',     // case
  ])
    assert.ok(titleMatches(cnic, title), title)
})

test('somebody else is not a match, however fuzzy the test', () => {
  const cnic = 'Monis Ur Rahmaan'
  for (const title of ['IMRAN KHAN', 'FATIMA BIBI', 'AKHUWAT', 'ZAHID HUSSAIN', 'A B C'])
    assert.ok(!titleMatches(cnic, title), title)
})

test('a long name keeps its surname: initials alone are not a name', () => {
  assert.ok(!titleMatches('Muhammad Yousaf Khan', 'M Y K'))
  assert.ok(titleMatches('Muhammad Yousaf Khan', 'M YOUSAF KHAN'))
  // A common Pakistani shortening: the honorific-like first name dropped.
  assert.ok(titleMatches('Muhammad Yousaf Khan', 'YOUSAF KHAN'))
})
