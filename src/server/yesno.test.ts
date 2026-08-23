import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readYesNo } from '../shared/steps.ts'

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
