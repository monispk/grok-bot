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
 *
 * Built against the rails' own specifications, in docs/rails: Easypaisa's
 * "REST APIs without RSA", JazzCash's "MWallet REST API v1.1 (Without CNIC)",
 * its "Status Inquiry Guide" and its "HMAC-SHA256 Calculation". Where this
 * file disagreed with them it was this file that was wrong, and the comments
 * below say how — the details cost a rider a real payment to find.
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
  /**
   * The orchestrator. Given with or without its path — an environment file has
   * carried both — so the path is stripped here and added once by each caller.
   */
  base: (process.env.JAZZCASH_BASE_URL || 'https://onlinepayments.jazzcash.com.pk')
    .replace(/\/+$/, '')
    .replace(/\/payment-orchestrator$/, ''),
  merchantId: process.env.JAZZCASH_MERCHANT_ID ?? '',
  password: process.env.JAZZCASH_PASSWORD ?? '',
  salt: process.env.JAZZCASH_INTEGRITY_SALT ?? '',
  // Mandatory, and must be the URL registered with JazzCash: any other
  // value fails validation.
  returnUrl: process.env.JAZZCASH_RETURN_URL ?? '',
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
export function hashMessage(fields: Record<string, string>, salt: string): string {
  const ordered = Object.keys(fields)
    .filter((k) => k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] != null)
    .sort()
    .map((k) => fields[k])
  return [salt, ...ordered].join('&')
}

export function secureHash(fields: Record<string, string>, salt: string): string {
  return createHmac('sha256', salt).update(hashMessage(fields, salt)).digest('hex').toUpperCase()
}

export function hashMatches(body: Record<string, string>, salt: string): boolean {
  const given = (body['pp_SecureHash'] ?? '').toUpperCase()
  return given !== '' && given === secureHash(body, salt)
}

/**
 * Logs what a rail actually said, minus anything that identifies the merchant.
 *
 * A rail's prose is written for a shopper — "contact the merchant" — and the
 * code beside it is what an integrator needs. Both were being thrown away, so
 * the orchestrator's first real answer took a second request to read.
 */
function traceRail(rail: string, json: Record<string, unknown> | null) {
  if (!json) return
  const SECRET = /password|securehash|credential|salt|merchantid/i
  const kept = Object.entries(json)
    .filter(([k, v]) => !SECRET.test(k) && v !== '' && v != null)
    .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`)
  console.log(`${rail}: ${kept.join(' ')}`)
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

/**
 * Easypaisa's response codes, from the REST API guide. Written out because
 * responseDesc is not always sent, and because "0013" tells a recruiter far
 * more than a bare code does.
 */
const EP_CODES: Record<string, string> = {
  '0000': 'SUCCESS',
  '0001': 'SYSTEM ERROR',
  '0002': 'REQUIRED FIELD MISSING',
  '0003': 'INVALID ORDER ID',
  '0004': 'INVALID MERCHANT ACCOUNT NUMBER',
  '0005': 'MERCHANT ACCOUNT NOT ACTIVE',
  '0006': 'INVALID STORE ID',
  '0007': 'STORE NOT ACTIVE',
  '0008': 'PAYMENT METHOD NOT ENABLED',
  '0010': 'INVALID CREDENTIALS',
  '0013': 'LOW BALANCE',
  '0014': 'ACCOUNT DOES NOT EXIST',
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
  const message = EP_CODES[code] ?? String(json['responseDesc'] ?? json['response_message'] ?? '')
  if (code === '0000') return { ...base, state: 'paid', detail: message || 'paid' }
  // SYSTEM ERROR is not "in progress" — the spec has no in-progress code for
  // an MA initiate — but the order may exist all the same, so it is left for
  // the inquiry to settle rather than called a failure here.
  if (code === '0001') return { ...base, state: 'pending', detail: `${message} — confirming by inquiry` }
  return { ...base, detail: message || `code ${code}` }
}

/**
 * Asks JazzCash to debit the rider's mobile wallet — MWallet REST API v1.1.
 *
 * The payload is exact. Its guide says parameters may not be added or removed
 * and names must match, and this file used to send an older shape: pp_BankID,
 * pp_ProductID, pp_SubMerchantID, pp_MobileNumber and pp_CNIC, against an
 * endpoint (/ApplicationAPI/API/Payment/DoMWalletTransaction) that is not the
 * orchestrator's. The wallet number belongs in ppmpf_1, and is mandatory.
 *
 * Amounts are paisa: the guide says multiply by 100, so Rs 2 is "200", which
 * is what CHARGE_PAISA already holds. Expiry is one day after the transaction.
 */
export async function payJazzcash(phone: string, _cnic: string, ref: string): Promise<Attempt> {
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
  const expires = new Date(now.getTime() + 24 * 60 * 60_000)
  const fields: Record<string, string> = {
    pp_Amount: String(CHARGE_PAISA),
    pp_BillReference: 'riderfee',
    pp_Description: 'foodpanda rider registration fee',
    pp_Language: 'EN',
    pp_MerchantID: JC.merchantId,
    pp_Password: JC.password,
    pp_ReturnURL: JC.returnUrl,
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: stamp(now),
    pp_TxnExpiryDateTime: stamp(expires),
    pp_TxnRefNo: ref,
    pp_TxnType: 'MWALLET',
    pp_Version: '1.1',
    ppmpf_1: localNumber(phone),
    ppmpf_2: '',
    ppmpf_3: '',
    ppmpf_4: '',
    ppmpf_5: '',
  }
  fields['pp_SecureHash'] = secureHash(fields, JC.salt)

  const { json, timedOut, detail } = await send(
    `${JC.base}/payment-orchestrator/api/v1/rest/payments/m-wallet`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    },
    JC.timeout,
  )

  if (timedOut) return { ...base, state: 'pending', detail: 'initiate timed out — confirm by inquiry' }
  if (!json) return { ...base, detail }

  traceRail('jazzcash initiate', json)
  const code = String(json['pp_ResponseCode'] ?? '')
  const message = String(json['pp_ResponseMessage'] ?? '')
  if (code === '000' || code === '121') return { ...base, state: 'paid', detail: message || 'paid' }
  if (code === '124' || code === '157') return { ...base, state: 'pending', detail: message || 'in progress' }
  return { ...base, detail: `${code}: ${message}` }
}

/** A reference the rail will accept and a person can read back to us. */
/**
 * A reference the rail will accept and a person can read back to us.
 *
 * JazzCash specifies its own shape: three letters of the merchant's domain,
 * then the date and time, at most twenty alphanumeric characters.
 *
 * Easypaisa's was shortened once to twelve digits, to rule the order id out
 * as a cause of a debit their app refuses with a generic ESB99999. It was not
 * the cause — both lengths were accepted and both debits refused — so the
 * original is back rather than a change that bought nothing.
 */
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
  traceRail('easypaisa inquiry', json)
  const code = String(json['responseCode'] ?? '')
  const status = String(json['transactionStatus'] ?? json['status'] ?? '').toUpperCase().replace(/\s+/g, '')
  // responseDesc says whether the *inquiry* worked ("SUCCESS"), which is not
  // the news. The transaction's own reason is in errorCode / errorReason —
  // "NO_RESPONSE_FROM_EWP: you did not approve the transaction" — and that
  // is what the recruiter and the logs need to see.
  const why = [json['errorCode'], json['errorReason']].filter(Boolean).map(String).join(': ')
  const message = why || String(json['responseDesc'] ?? '')
  if (status === 'PAID' || status === 'SUCCESS') return { ...base, state: 'paid', detail: `PAID${why ? ` (${why})` : ''}` }
  // The status only prefixes the reason when the reason does not already
  // carry it: "FAILED: FAILED: ..." said it twice.
  if (/FAILED|EXPIRED|REVERSED|CANCEL/.test(status))
    return {
      ...base,
      state: 'failed',
      detail: message.startsWith(status) ? message : `${status}: ${message}`,
    }
  // UNPAID, PENDING, IN PROGRESS, or an inquiry that answered without a
  // status: not yet, as far as anyone knows.
  return { ...base, detail: message || status || `code ${code}` }
}

/**
 * Asks JazzCash what became of a transaction — the Status Inquiry API.
 *
 * pp_ResponseCode here reports on the *inquiry*, and is "000" whenever the
 * inquiry itself worked. The payment is pp_Status and pp_PaymentResponseCode,
 * where 121 means completed and debited. Reading the wrong one, this file
 * called a completed JazzCash payment "pending" — and after the wait, a rider
 * who had paid would have been told their fee never arrived.
 */
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
    `${JC.base}/payment-orchestrator/api/v1/rest/payments/status/inquiry`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) },
    JC.timeout,
  )
  if (timedOut || !json) return { ...base, detail: detail || 'no answer yet' }
  traceRail('jazzcash inquiry', json)

  const asked = String(json['pp_ResponseCode'] ?? '')
  if (asked && asked !== '000')
    return { ...base, detail: `inquiry ${asked}: ${String(json['pp_ResponseMessage'] ?? '')}` }

  const status = String(json['pp_Status'] ?? '').toUpperCase()
  const paidCode = String(json['pp_PaymentResponseCode'] ?? '')
  const why = String(json['pp_PaymentResponseMessage'] ?? '') || status || paidCode
  if (status === 'COMPLETED' || paidCode === '121') return { ...base, state: 'paid', detail: why || 'paid' }
  if (status === 'PENDING' || paidCode === '124' || paidCode === '') return { ...base, detail: why || 'in progress' }
  return { ...base, state: 'failed', detail: `${status || paidCode}: ${why}` }
}

export const inquire = (rail: 'easypaisa' | 'jazzcash', ref: string) =>
  rail === 'jazzcash' ? inquireJazzcash(ref) : inquireEasypaisa(ref)

/**
 * One JazzCash request, in a named shape, for finding out which shape a
 * merchant account actually accepts.
 *
 * Their guide describes MWallet v1.1 on the orchestrator, and that shape is
 * refused with "insufficient merchant information" while the same credentials
 * pass Status Inquiry on the same host — so something about the payload or the
 * endpoint is not what this account expects. A developer elsewhere has taken a
 * payment with these credentials, so the difference is findable.
 *
 * Temporary. Delete it once the working shape is known.
 */
export type Variant =
  | 'v1.1'
  | 'v1.1+legacy-fields'
  | 'v1.1+mobile'
  | 'v2'
  | 'v2+mobile'
  | 'v2+mobile+ppmpf'
  | 'v2+mobile+cnic'
  | 'v1.1+ppmpf+cnic'
  | 'legacy-gateway'

export async function probeJazzcash(
  variant: Variant,
  phone: string,
  amountPaisa: number,
  cnic = '',
): Promise<{ variant: Variant; url: string; sent: string[]; answer: Record<string, unknown> | null; detail: string }> {
  const ref = `${JC.prefix}${stamp()}`
  const now = new Date()
  const expires = new Date(now.getTime() + 24 * 60 * 60_000)

  const common: Record<string, string> = {
    pp_Amount: String(amountPaisa),
    pp_BillReference: 'riderfee',
    pp_Description: 'foodpanda rider registration fee',
    pp_Language: 'EN',
    pp_MerchantID: JC.merchantId,
    pp_Password: JC.password,
    pp_ReturnURL: JC.returnUrl,
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: stamp(now),
    pp_TxnExpiryDateTime: stamp(expires),
    pp_TxnRefNo: ref,
    pp_TxnType: 'MWALLET',
  }

  const ORCH = `${JC.base}/payment-orchestrator/api`
  const shapes: Record<Variant, { url: string; fields: Record<string, string> }> = {
    'v1.1': {
      url: `${ORCH}/v1/rest/payments/m-wallet`,
      fields: { ...common, pp_Version: '1.1', ppmpf_1: localNumber(phone), ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '' },
    },
    // The older payload shape, on the orchestrator: some accounts are
    // provisioned expecting the bank and product fields to be present.
    'v1.1+legacy-fields': {
      url: `${ORCH}/v1/rest/payments/m-wallet`,
      fields: {
        ...common, pp_Version: '1.1', pp_SubMerchantID: '', pp_BankID: '', pp_ProductID: '',
        pp_MobileNumber: localNumber(phone), ppmpf_1: localNumber(phone),
        ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '',
      },
    },
    // v1.1 named the wallet in ppmpf_1; adding pp_MobileNumber to it broke the
    // hash, which says the gateway does not know that field at this version
    // and leaves it out of its own calculation.
    'v1.1+mobile': {
      url: `${ORCH}/v1/rest/payments/m-wallet`,
      fields: { ...common, pp_Version: '1.1', pp_MobileNumber: localNumber(phone) },
    },
    v2: {
      url: `${ORCH}/v2/rest/payments/m-wallet`,
      fields: { ...common, pp_Version: '2.0', ppmpf_1: localNumber(phone), ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '' },
    },
    // v2 accepted the hash and asked for pp_MobileNumber by name, which is the
    // first thing either version has asked us for.
    'v2+mobile': {
      url: `${ORCH}/v2/rest/payments/m-wallet`,
      fields: { ...common, pp_Version: '2.0', pp_MobileNumber: localNumber(phone) },
    },
    /**
     * v2 asked for pp_MobileNumber, then for pp_CNIC. The guide we were given
     * is "MWallet v1.1 (Without CNIC)" — so v2 is the with-CNIC API, and this
     * account may be provisioned for that one. JazzCash takes the last six
     * digits of the card.
     */
    'v2+mobile+cnic': {
      url: `${ORCH}/v2/rest/payments/m-wallet`,
      fields: {
        ...common,
        pp_Version: '2.0',
        pp_MobileNumber: localNumber(phone),
        pp_CNIC: cnic.replace(/\D/g, '').slice(-6),
      },
    },
    'v1.1+ppmpf+cnic': {
      url: `${ORCH}/v1/rest/payments/m-wallet`,
      fields: {
        ...common,
        pp_Version: '1.1',
        pp_CNIC: cnic.replace(/\D/g, '').slice(-6),
        ppmpf_1: localNumber(phone), ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '',
      },
    },
    'v2+mobile+ppmpf': {
      url: `${ORCH}/v2/rest/payments/m-wallet`,
      fields: {
        ...common, pp_Version: '2.0', pp_MobileNumber: localNumber(phone),
        ppmpf_1: localNumber(phone), ppmpf_2: '', ppmpf_3: '', ppmpf_4: '', ppmpf_5: '',
      },
    },
    // The host the environment file named before the guides arrived. It could
    // not be reached from a laptop, which proves nothing: that laptop is also
    // refused by Groq.
    'legacy-gateway': {
      url: 'https://payments.jazzcash.com.pk/ApplicationAPI/API/Payment/DoMWalletTransaction',
      fields: {
        ...common, pp_Version: '1.1', pp_SubMerchantID: '', pp_BankID: '', pp_ProductID: '',
        pp_MobileNumber: localNumber(phone), pp_CNIC: '', ppmpf_1: '',
      },
    },
  }

  const { url, fields } = shapes[variant]
  fields['pp_SecureHash'] = secureHash(fields, JC.salt)
  const { json, timedOut, detail } = await send(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) },
    JC.timeout,
  )
  traceRail(`jazzcash probe ${variant}`, json)
  const SECRET = /password|securehash/i
  return {
    variant,
    url,
    sent: Object.keys(fields).filter((k) => !SECRET.test(k)).sort(),
    answer: json,
    detail: timedOut ? 'timed out' : detail,
  }
}
