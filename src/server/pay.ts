import { createHmac } from 'node:crypto'
import { CHARGE_PAISA, feeOverridden, rupees } from './fee.ts'

/**
 * The registration fee, taken in the chat.
 *
 * Two rails, one rule that matters more than either: **an initiate that times
 * out has not necessarily failed.** The request and the debit are independent,
 * and a confirmation can arrive a minute later. Telling a rider "nothing was
 * charged" when their wallet has already been debited is the worst thing this
 * module could do, so a timeout leaves the transaction `pending` and the truth
 * is established by asking again.
 *
 * Both rails ship disabled. These are live merchant accounts — every initiate
 * is a real debit — so nothing here moves money until the enable flags are set
 * deliberately.
 */
export type PayState = 'initiated' | 'pending' | 'paid' | 'failed'

export type Attempt = {
  rail: 'easypaisa' | 'jazzcash'
  state: PayState
  amountPaisa: number
  ref: string
  /** What the rail said, for the recruiter and the logs. Never shown to a rider. */
  detail: string
}

const EP = {
  enabled: (process.env.EASYPAISA_ENABLED ?? 'false') !== 'false',
  base: process.env.EASYPAISA_BASE_URL ?? '',
  username: process.env.EASYPAISA_USERNAME ?? '',
  password: process.env.EASYPAISA_PASSWORD ?? '',
  storeId: process.env.EASYPAISA_STORE_ID ?? '',
  accountNum: process.env.EASYPAISA_ACCOUNT_NUM ?? '',
  // Easypaisa refuses an initiate without an email ("REQUIRED FIELD MISSING").
  // Nothing is sent to it; it is the merchant's contact on the transaction.
  email: process.env.EASYPAISA_EMAIL ?? 'riders@rozee.pk',
  initiateTimeout: Number(process.env.EASYPAISA_INITIATE_TIMEOUT ?? 30) * 1000,
  inquireTimeout: Number(process.env.EASYPAISA_INQUIRE_TIMEOUT ?? 20) * 1000,
}

const JC = {
  // ENABLED alone only says the fields are present; PRODUCTION_READY is what
  // permits a real debit.
  enabled:
    (process.env.JAZZCASH_ENABLED ?? 'false') !== 'false' &&
    (process.env.JAZZCASH_PRODUCTION_READY ?? 'false') !== 'false',
  base: process.env.JAZZCASH_BASE_URL ?? '',
  merchantId: process.env.JAZZCASH_MERCHANT_ID ?? '',
  password: process.env.JAZZCASH_PASSWORD ?? '',
  salt: process.env.JAZZCASH_INTEGRITY_SALT ?? '',
  prefix: process.env.JAZZCASH_TXNREF_PREFIX ?? 'RzB',
  timeout: Number(process.env.JAZZCASH_TIMEOUT_SECONDS ?? 30) * 1000,
}

export const easypaisaReady = () => Boolean(EP.enabled && EP.username && EP.storeId)
export const jazzcashReady = () => Boolean(JC.enabled && JC.merchantId && JC.salt)
export const anyRailReady = () => easypaisaReady() || jazzcashReady()

/** Rails refuse anything but digits, and want the local form. */
const localNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '')
  return d.startsWith('92') ? `0${d.slice(2)}` : d
}

const stamp = (d = new Date()) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('')

/**
 * JazzCash signs every request: the integrity salt, then each non-empty field
 * in key order, joined by ampersands, through HMAC-SHA256 keyed by that same
 * salt. Responses and IPNs carry the same hash and are checked the same way —
 * an unsigned status is not a status.
 */
export function secureHash(fields: Record<string, string>, salt: string): string {
  const ordered = Object.keys(fields)
    .filter((k) => k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] != null)
    .sort()
    .map((k) => fields[k])
  return createHmac('sha256', salt).update([salt, ...ordered].join('&')).digest('hex').toUpperCase()
}

export function hashMatches(body: Record<string, string>, salt: string): boolean {
  const given = (body['pp_SecureHash'] ?? '').toUpperCase()
  return given !== '' && given === secureHash(body, salt)
}

async function send(
  url: string,
  init: RequestInit,
  timeout: number,
): Promise<{ json: Record<string, unknown> | null; timedOut: boolean; detail: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) })
    const text = await res.text()
    try {
      return { json: JSON.parse(text) as Record<string, unknown>, timedOut: false, detail: '' }
    } catch {
      return { json: null, timedOut: false, detail: `not json (http ${res.status})` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'request failed'
    // A timeout is not a failure. The debit may already have gone through.
    const timedOut = /abort|timeout|timed out/i.test(message)
    return { json: null, timedOut, detail: message }
  }
}

function guardAmount() {
  if (feeOverridden)
    console.warn(
      `pay: charging ${rupees(CHARGE_PAISA)} — a test override is in force. ` +
        'Riders are being told a different figure.',
    )
}

/** Asks Easypaisa to debit the rider's mobile account. */
export async function payEasypaisa(phone: string, orderId: string): Promise<Attempt> {
  const base: Attempt = {
    rail: 'easypaisa',
    state: 'failed',
    amountPaisa: CHARGE_PAISA,
    ref: orderId,
    detail: '',
  }
  if (!easypaisaReady()) return { ...base, detail: 'not enabled' }
  guardAmount()

  const { json, timedOut, detail } = await send(
    `${EP.base}/easypay-service/rest/v4/initiate-ma-transaction`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        credentials: Buffer.from(`${EP.username}:${EP.password}`).toString('base64'),
      },
      body: JSON.stringify({
        orderId,
        storeId: /^\d+$/.test(EP.storeId) ? Number(EP.storeId) : EP.storeId,
        // The rails are quoted in rupees, not paisa, on this endpoint, and
        // Easypaisa wants a decimal: "2.0", not "2".
        transactionAmount: (CHARGE_PAISA / 100).toFixed(1),
        transactionType: 'MA',
        mobileAccountNo: localNumber(phone),
        emailAddress: EP.email,
      }),
    },
    EP.initiateTimeout,
  )

  if (timedOut) return { ...base, state: 'pending', detail: 'initiate timed out — confirm by inquiry' }
  if (!json) return { ...base, detail }

  const code = String(json['responseCode'] ?? json['response_code'] ?? '')
  const message = String(json['responseDesc'] ?? json['response_message'] ?? '')
  // 0000 is taken; 0001 is in progress and settles later.
  if (code === '0000') return { ...base, state: 'paid', detail: message || 'paid' }
  if (code === '0001') return { ...base, state: 'pending', detail: message || 'in progress' }
  return { ...base, detail: message || `code ${code}` }
}

/** Asks JazzCash to debit the rider's mobile wallet. */
export async function payJazzcash(phone: string, cnic: string, ref: string): Promise<Attempt> {
  const base: Attempt = {
    rail: 'jazzcash',
    state: 'failed',
    amountPaisa: CHARGE_PAISA,
    ref,
    detail: '',
  }
  if (!jazzcashReady()) return { ...base, detail: 'not enabled' }
  guardAmount()

  const now = new Date()
  const expires = new Date(now.getTime() + 60 * 60_000)
  const fields: Record<string, string> = {
    pp_Version: '1.1',
    pp_TxnType: 'MWALLET',
    pp_Language: 'EN',
    pp_MerchantID: JC.merchantId,
    pp_SubMerchantID: '',
    pp_Password: JC.password,
    pp_BankID: '',
    pp_ProductID: '',
    pp_TxnRefNo: ref,
    // JazzCash takes paisa, and gets them.
    pp_Amount: String(CHARGE_PAISA),
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: stamp(now),
    pp_BillReference: 'riderfee',
    pp_Description: 'foodpanda rider registration fee',
    pp_TxnExpiryDateTime: stamp(expires),
    pp_ReturnURL: process.env.JAZZCASH_RETURN_URL ?? '',
    pp_MobileNumber: localNumber(phone),
    pp_CNIC: cnic.replace(/\D/g, '').slice(-6),
    ppmpf_1: '',
  }
  fields['pp_SecureHash'] = secureHash(fields, JC.salt)

  const { json, timedOut, detail } = await send(
    `${JC.base}/ApplicationAPI/API/Payment/DoMWalletTransaction`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    },
    JC.timeout,
  )

  if (timedOut) return { ...base, state: 'pending', detail: 'initiate timed out — confirm by inquiry' }
  if (!json) return { ...base, detail }

  const code = String(json['pp_ResponseCode'] ?? '')
  const message = String(json['pp_ResponseMessage'] ?? '')
  if (code === '000') return { ...base, state: 'paid', detail: message || 'paid' }
  if (code === '121' || code === '124') return { ...base, state: 'pending', detail: message }
  return { ...base, detail: message || `code ${code}` }
}

/** A reference the rail will accept and a person can read back to us. */
export const newRef = (rail: 'easypaisa' | 'jazzcash') =>
  rail === 'jazzcash'
    ? `${JC.prefix}${stamp()}`
    : `RZ${stamp()}${Math.floor(Math.random() * 900 + 100)}`

/**
 * Asks Easypaisa what became of an order. Safe to ask as often as needed: it
 * moves no money. The debit is approved by the rider in their Easypaisa app,
 * which can take a minute, so "unpaid" here means "not yet" until the caller
 * decides it has waited long enough.
 */
export async function inquireEasypaisa(orderId: string): Promise<Attempt> {
  const base: Attempt = { rail: 'easypaisa', state: 'pending', amountPaisa: CHARGE_PAISA, ref: orderId, detail: '' }
  if (!easypaisaReady()) return { ...base, state: 'failed', detail: 'not enabled' }
  const { json, timedOut, detail } = await send(
    `${EP.base}/easypay-service/rest/v4/inquire-transaction`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        credentials: Buffer.from(`${EP.username}:${EP.password}`).toString('base64'),
      },
      body: JSON.stringify({ orderId, storeId: /^\d+$/.test(EP.storeId) ? Number(EP.storeId) : EP.storeId, accountNum: EP.accountNum }),
    },
    EP.inquireTimeout,
  )
  if (timedOut || !json) return { ...base, detail: detail || 'no answer yet' }
  const code = String(json['responseCode'] ?? '')
  const status = String(json['transactionStatus'] ?? json['status'] ?? '').toUpperCase().replace(/\s+/g, '')
  // responseDesc says whether the *inquiry* worked ("SUCCESS"), which is not
  // the news. The transaction's own reason is in errorCode / errorReason —
  // "NO_RESPONSE_FROM_EWP: you did not approve the transaction" — and that
  // is what the recruiter and the logs need to see.
  const why = [json['errorCode'], json['errorReason']].filter(Boolean).map(String).join(': ')
  const message = why || String(json['responseDesc'] ?? '')
  if (status === 'PAID' || status === 'SUCCESS') return { ...base, state: 'paid', detail: `PAID${why ? ` (${why})` : ''}` }
  if (/FAILED|EXPIRED|REVERSED|CANCEL/.test(status)) return { ...base, state: 'failed', detail: `${status}: ${message}` }
  // UNPAID, PENDING, IN PROGRESS, or an inquiry that answered without a
  // status: not yet, as far as anyone knows.
  return { ...base, detail: message || status || `code ${code}` }
}

/** Asks JazzCash what became of a transaction. Signed like everything else. */
export async function inquireJazzcash(ref: string): Promise<Attempt> {
  const base: Attempt = { rail: 'jazzcash', state: 'pending', amountPaisa: CHARGE_PAISA, ref, detail: '' }
  if (!jazzcashReady()) return { ...base, state: 'failed', detail: 'not enabled' }
  const fields: Record<string, string> = {
    pp_TxnRefNo: ref,
    pp_MerchantID: JC.merchantId,
    pp_Password: JC.password,
  }
  fields['pp_SecureHash'] = secureHash(fields, JC.salt)
  const { json, timedOut, detail } = await send(
    `${JC.base}/ApplicationAPI/API/PaymentInquiry/Inquire`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) },
    JC.timeout,
  )
  if (timedOut || !json) return { ...base, detail: detail || 'no answer yet' }
  const code = String(json['pp_ResponseCode'] ?? '')
  const message = String(json['pp_ResponseMessage'] ?? '')
  if (code === '000') return { ...base, state: 'paid', detail: message || 'paid' }
  if (code === '121' || code === '124' || code === '' ) return { ...base, detail: message || 'in progress' }
  return { ...base, state: 'failed', detail: message || `code ${code}` }
}

export const inquire = (rail: 'easypaisa' | 'jazzcash', ref: string) =>
  rail === 'jazzcash' ? inquireJazzcash(ref) : inquireEasypaisa(ref)
