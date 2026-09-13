import assert from 'node:assert/strict'
import { test } from 'node:test'

// The rail module reads its settings when it loads, so they are set first.
process.env.EASYPAISA_ENABLED = 'true'
process.env.EASYPAISA_BASE_URL = 'http://rail.test'
process.env.EASYPAISA_USERNAME = 'u'
process.env.EASYPAISA_PASSWORD = 'p'
process.env.EASYPAISA_STORE_ID = '1'
process.env.JAZZCASH_ENABLED = 'true'
process.env.JAZZCASH_PRODUCTION_READY = 'true'
process.env.JAZZCASH_BASE_URL = 'http://rail.test'
process.env.JAZZCASH_MERCHANT_ID = 'MC1'
process.env.JAZZCASH_PASSWORD = 'pw'
process.env.JAZZCASH_INTEGRITY_SALT = 'salt'
const { inquireEasypaisa, inquireJazzcash } = await import('./pay.ts')

const answering = (body: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
}

test('an inquiry reads the transaction status, not the call status', async () => {
  // Reported: "not received" said the moment the request went out. The rider
  // approves it in their app, which takes a minute; until then the rail says
  // UNPAID, and UNPAID is "not yet", not "no".
  answering({ responseCode: '0000', responseDesc: 'ok', transactionStatus: 'UNPAID' })
  assert.equal((await inquireEasypaisa('RZ1')).state, 'pending')
  answering({ responseCode: '0000', transactionStatus: 'PAID' })
  assert.equal((await inquireEasypaisa('RZ1')).state, 'paid')
  answering({ responseCode: '0000', transactionStatus: 'FAILED' })
  assert.equal((await inquireEasypaisa('RZ1')).state, 'failed')
  // A rail that does not answer has not said no.
  globalThis.fetch = (async () => { throw new Error('timed out') }) as typeof fetch
  assert.equal((await inquireEasypaisa('RZ1')).state, 'pending')
})

test('a completed JazzCash payment is not reported as pending', async () => {
  // From the Status Inquiry Guide: pp_ResponseCode reports on the inquiry,
  // pp_PaymentResponseCode 121 and pp_Status "Completed" report the payment.
  // Reading the first as the payment called a paid fee pending.
  answering({
    pp_ResponseCode: '000',
    pp_ResponseMessage: 'Thank you for using JazzCash, your operation was processed successfully.',
    pp_PaymentResponseCode: '121',
    pp_PaymentResponseMessage: 'Your transaction was processed successfully.',
    pp_Status: 'Completed',
  })
  assert.equal((await inquireJazzcash('T1')).state, 'paid')

  answering({ pp_ResponseCode: '000', pp_PaymentResponseCode: '124', pp_Status: 'Pending' })
  assert.equal((await inquireJazzcash('T1')).state, 'pending')

  answering({ pp_ResponseCode: '000', pp_PaymentResponseCode: '199', pp_Status: 'Failed' })
  assert.equal((await inquireJazzcash('T1')).state, 'failed')

  // An inquiry that itself failed says nothing about the payment.
  answering({ pp_ResponseCode: '110', pp_ResponseMessage: 'Invalid hash' })
  assert.equal((await inquireJazzcash('T1')).state, 'pending')
})
