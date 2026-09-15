import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asIban, asMobile, candidates, digitsOnly, mod97 } from '../shared/account.ts'
import { BANKS, knownBank } from '../shared/banks.ts'

const bank = (name: string) => knownBank(name)!

test('a rider names their bank however they like', () => {
  assert.equal(bank('HBL').id, '23')
  assert.equal(bank('habib bank').id, '23')
  assert.equal(bank('meezan').id, '59')
  assert.equal(bank('Bank Alfalah Limited').id, '9')
  assert.equal(bank('jazzcash').id, '33')
  assert.equal(bank('easypaisa').id, '51')
  assert.equal(bank('mera account UBL mein hai').id, '2')
})

/**
 * "Habib" belongs to HBL, Bank AL Habib and Habib Metropolitan — three banks
 * with three different account formats. An answer that fits more than one fits
 * none, and the rider is asked again rather than guessed at.
 */
test('an ambiguous name is not guessed at', () => {
  assert.equal(knownBank('habib'), null)
  assert.equal(knownBank('islamic'), null)
  assert.equal(knownBank('kuch nahi pata'), null)
  assert.equal(knownBank(''), null)
})

test('Urdu digits are digits', () => {
  assert.equal(digitsOnly('۰۳۳۴۸۲۳۴۴۴۴'), '03348234444')
  assert.equal(digitsOnly('1060-00243789-03'), '10600024378903')
})

test('an IBAN is recognised, and a broken one is not', () => {
  assert.equal(asIban('PK03HABB0050097900675355'), 'PK03HABB0050097900675355')
  assert.equal(asIban('PK03 HABB 0050 0979 0067 5355'), 'PK03HABB0050097900675355')
  // One digit changed: mod-97 is what catches it.
  assert.equal(asIban('PK03HABB0050097900675356'), null)
  assert.equal(mod97('PK03HABB0050097900675355'), true)
})

test('a mobile number, however it was written', () => {
  for (const said of ['03348234444', '+923348234444', '923348234444', '00923348234444', '3348234444'])
    assert.equal(asMobile(said), '03348234444', said)
  // Not a mobile: a landline, and an account number that happens to be short.
  assert.equal(asMobile('0512345678'), null)
  assert.equal(asMobile('50097900675355'), null)
})

test('a wallet is tried as a mobile number and nothing else', () => {
  const c = candidates(bank('jazzcash'), '+92 334 8234444')
  assert.equal(c[0]!.send, '03348234444')
  assert.ok(c.every((x) => x.send === '03348234444'))
})

/**
 * The published Akhuwat account, which the live service resolves to "AKHUWAT".
 * Dashes, and the leading zeros a spreadsheet would have eaten.
 */
test('an HBL account survives the ways it arrives', () => {
  const hbl = bank('HBL')
  assert.equal(candidates(hbl, '5009-79006753-55')[0]!.send, '50097900675355')
  // Short by two: the branch code lost its zeros.
  const padded = candidates(hbl, '870027000100')
  assert.ok(padded.some((c) => c.send === '00870027000100'), JSON.stringify(padded))
})

test('a branch code written twice is dropped', () => {
  const meezan = bank('meezan')
  // 14 is Meezan's length; this is 18 — a 4-digit branch written in front again.
  const c = candidates(meezan, '016501650111226444')
  assert.ok(c.some((x) => x.send === '01650111226444'), JSON.stringify(c))
})

test('nothing is guessed more than a few digits', () => {
  // Short by six is not a missing zero, it is a different number.
  const c = candidates(bank('meezan'), '11226444')
  assert.ok(!c.some((x) => x.send.length === 14 && x.send.startsWith('000000')), JSON.stringify(c))
})

test('every bank the service knows has an id and a name', () => {
  assert.equal(BANKS.length, 33)
  assert.ok(BANKS.every((b) => /^\d+$/.test(b.id) && b.name && b.code))
  assert.equal(new Set(BANKS.map((b) => b.id)).size, 33)
})
