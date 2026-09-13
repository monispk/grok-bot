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
/**
 * A pending order settles this long after it was initiated — the rider
 * finding the request in their wallet app and approving it. What the
 * inquiry answers before then is "not yet".
 */
const SETTLE_MS = Number(process.env.MOCK_SETTLE_MS ?? 6000)
const started = new Map()

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
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch {}

    if (req.url?.includes('inquire-transaction')) {
      const at = started.get(body.orderId)
      const settled = HOW === 'paid' || (HOW === 'pending' && at && Date.now() - at >= SETTLE_MS)
      return res.end(JSON.stringify({
        responseCode: '0000',
        responseDesc: 'mock inquiry',
        orderId: body.orderId,
        transactionStatus: settled ? 'PAID' : HOW === 'failed' ? 'FAILED' : 'UNPAID',
      }))
    }
    if (req.url?.includes('PaymentInquiry')) {
      const at = started.get(body.pp_TxnRefNo)
      const settled = HOW === 'paid' || (HOW === 'pending' && at && Date.now() - at >= SETTLE_MS)
      return res.end(JSON.stringify({ pp_ResponseCode: settled ? '000' : HOW === 'failed' ? '210' : '124', pp_ResponseMessage: 'mock inquiry' }))
    }
    started.set(body.orderId ?? body.pp_TxnRefNo, Date.now())
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
