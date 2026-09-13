import assert from 'node:assert/strict'
import { test } from 'node:test'

// The rail module reads its settings when it loads, so they are set first.
process.env.EASYPAISA_ENABLED = 'true'
process.env.EASYPAISA_BASE_URL = 'http://rail.test'
process.env.EASYPAISA_USERNAME = 'u'
process.env.EASYPAISA_PASSWORD = 'p'
process.env.EASYPAISA_STORE_ID = '1'
const { inquireEasypaisa } = await import('./pay.ts')

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
