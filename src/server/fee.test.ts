import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rupees } from './fee.ts'

test('paisa are written the way the rider is told', () => {
  assert.equal(rupees(250_000), 'Rs. 2,500')
  assert.equal(rupees(200), 'Rs. 2')
  assert.equal(rupees(6_000_000), 'Rs. 60,000')
})
