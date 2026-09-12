/**
 * Offline stand-ins for Easypaisa and JazzCash.
 *
 * Pointed at by EASYPAISA_BASE_URL and JAZZCASH_BASE_URL, so the real client
 * code runs — its signing, its response parsing, its rupees-versus-paisa — and
 * only the merchant is imaginary. A rail cannot be probed for real: every
 * initiate is a debit against a live account.
 *
 *   MOCK_PAY=paid|pending|failed|timeout  node scripts/mock-rails.mjs
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_RAILS_PORT ?? 4012)
const HOW = process.env.MOCK_PAY ?? 'paid'

const EASYPAISA = { paid: '0000', pending: '0001', failed: '0005' }
const JAZZCASH = { paid: '000', pending: '121', failed: '210' }

http
  .createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    console.log(`mock rail: ${req.url} ${raw.slice(0, 140)}`)

    // A rail that never answers. The client must leave the transaction pending
    // rather than tell a rider nothing was charged.
    if (HOW === 'timeout') return

    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url?.includes('easypay-service'))
      return res.end(
        JSON.stringify({
          responseCode: EASYPAISA[HOW] ?? '0005',
          responseDesc: `mock rail: ${HOW}`,
        }),
      )
    return res.end(
      JSON.stringify({
        pp_ResponseCode: JAZZCASH[HOW] ?? '210',
        pp_ResponseMessage: `mock rail: ${HOW}`,
      }),
    )
  })
  .listen(PORT, () => console.log(`mock rails on :${PORT} (answering "${HOW}")`))
