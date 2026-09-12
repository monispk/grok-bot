import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashMatches, secureHash } from './pay.ts'

// JazzCash's published worked example: the salt, then every non-empty field in
// key order, joined by ampersands, through HMAC-SHA256 keyed by that same salt.
const SALT = 'test_integrity_salt'

test('the signature covers every non-empty field, in key order', () => {
  const a = secureHash({ pp_Amount: '200', pp_TxnRefNo: 'T1', pp_Version: '1.1' }, SALT)
  // Key order, not the order they were written.
  const b = secureHash({ pp_Version: '1.1', pp_TxnRefNo: 'T1', pp_Amount: '200' }, SALT)
  assert.equal(a, b)
  assert.match(a, /^[0-9A-F]{64}$/)
})

test('an empty field changes nothing, and a real one changes everything', () => {
  const base = { pp_Amount: '200', pp_TxnRefNo: 'T1' }
  assert.equal(secureHash(base, SALT), secureHash({ ...base, pp_SubMerchantID: '' }, SALT))
  assert.notEqual(secureHash(base, SALT), secureHash({ ...base, pp_Amount: '250000' }, SALT))
})

test('the hash field never signs itself', () => {
  const fields = { pp_Amount: '200', pp_TxnRefNo: 'T1' }
  const signed = { ...fields, pp_SecureHash: secureHash(fields, SALT) }
  assert.equal(secureHash(signed, SALT), secureHash(fields, SALT))
})

test('a reply is only a reply if it is signed', () => {
  const fields = { pp_ResponseCode: '000', pp_TxnRefNo: 'T1' }
  assert.ok(hashMatches({ ...fields, pp_SecureHash: secureHash(fields, SALT) }, SALT))
  // Tampered amount, original signature.
  assert.ok(!hashMatches({ ...fields, pp_Amount: '1', pp_SecureHash: secureHash(fields, SALT) }, SALT))
  assert.ok(!hashMatches(fields, SALT), 'an unsigned reply was accepted')
})
