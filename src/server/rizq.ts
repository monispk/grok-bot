import { compareNames, phonetic, similarity } from './names.ts'

/**
 * Rizq BPS: whose wallet is this mobile number?
 *
 * The rider is paid weekly into this wallet and pays the fee from it, so a
 * number registered to somebody else is worth knowing about — foodpanda's own
 * rider training warns that an unregistered SIM or wallet gets an ID blocked.
 * We ask both rails about the same number and accept either.
 *
 * It is never a gate. A mismatch is a note for the recruiter, and a service
 * that does not answer leaves no note at all — showing a recruiter an untested
 * cross is worse than showing them nothing.
 */
const BASE = process.env.RIZQ_BPS_API_URL ?? 'https://api.rizq.com'
const APP_ID = process.env.RIZQ_BPS_APP_ID ?? ''
const APP_KEY = process.env.RIZQ_BPS_APP_KEY ?? ''
const ENABLED = (process.env.RIZQ_BPS_ENABLED ?? 'false') !== 'false'
const TIMEOUT = Number(process.env.RIZQ_BPS_TIMEOUT_SECONDS ?? 20) * 1000

const RAILS = [
  { rail: 'easypaisa', bankId: process.env.RIZQ_BPS_BANK_ID_EASYPAISA ?? '51' },
  { rail: 'jazzcash', bankId: process.env.RIZQ_BPS_BANK_ID_JAZZCASH ?? '33' },
] as const

export const rizqReady = () => Boolean(ENABLED && APP_ID && APP_KEY)

/** The token lasts about half an hour; this keeps it for twenty-five minutes. */
let cached: { token: string; until: number } | null = null

async function token(force = false): Promise<string | null> {
  if (!force && cached && cached.until > Date.now()) return cached.token
  try {
    const res = await fetch(`${BASE}/rest/api/auth/token`, {
      method: 'POST',
      headers: { appId: APP_ID, appKey: APP_KEY },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const text = await res.text()
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      console.error('rizq token: not json —', text.slice(0, 160))
      return null
    }
    const body = (json['response'] as Record<string, unknown>) ?? json
    const data = (body['data'] as Record<string, unknown>) ?? body
    const found =
      (typeof data['token'] === 'string' && data['token']) ||
      (typeof data['access_token'] === 'string' && data['access_token']) ||
      (typeof body['token'] === 'string' && body['token'])
    if (!found) {
      console.error('rizq token: no token in the reply —', text.slice(0, 200))
      return null
    }
    cached = { token: found, until: Date.now() + 25 * 60_000 }
    return found
  } catch (err) {
    console.error('rizq token:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Rizq wants the local form: 03001234567, not 923001234567. */
export const localNumber = (phone: string) =>
  phone.startsWith('92') ? `0${phone.slice(2)}` : phone

type Fetched =
  | { ok: true; title: string }
  | { ok: false; stale: true }
  | { ok: false; stale: false; code: string; message: string }

async function titleFetch(bankId: string, account: string, auth: string): Promise<Fetched | null> {
  try {
    const res = await fetch(`${BASE}/rest/api/bps/titleFetch`, {
      method: 'POST',
      headers: {
        appId: APP_ID,
        appKey: APP_KEY,
        // A `token` header, established by trying every placement against the
        // live service: an Authorization header — Bearer or raw — and the
        // token as a form field all come back 51, unauthenticated.
        token: auth,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ bankId, accountNumber: account }).toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const text = await res.text()
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      console.error('rizq titleFetch: not json —', text.slice(0, 160))
      return null
    }
    // Flat, unlike the Rozee services: {code, message, title} at the top.
    const code = String(json['code'] ?? '')
    const message = String(json['message'] ?? json['msg'] ?? '')
    const data = json

    // 51 is unauthenticated — a missing or rejected token, not a stale one.
    if (code === '51') return { ok: false, stale: true }
    if (code !== '11') return { ok: false, stale: false, code, message }

    const title = String(
      data['accountTitle'] ?? data['account_title'] ?? data['title'] ?? data['name'] ?? '',
    ).trim()
    return title
      ? { ok: true, title }
      : { ok: false, stale: false, code, message: 'no account title in the reply' }
  } catch (err) {
    console.error('rizq titleFetch:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * A wallet title against the name on the CNIC.
 *
 * Titles are abbreviated and inconsistently spelled — "M U RAHMAN" for "Monis
 * Ur Rahmaan" is an ordinary result, not a different person — so a single
 * letter standing for a name is allowed to match that name's initial.
 */
export function titleMatches(cnicName: string, title: string): boolean {
  // `review` counts here, where it does not on a document. On a CNIC it means
  // "let branch staff look at the originals"; on a wallet title it means the
  // spelling wandered, which is the normal case. This check never gates
  // anybody, so the cost of accepting a near-miss is nothing and the cost of
  // refusing one is a recruiter chasing a rider whose name was simply typed
  // differently at the counter.
  const seen = compareNames(cnicName, title).verdict
  if (seen === 'match' || seen === 'review') return true

  const words = (s: string) =>
    s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  const full = words(cnicName)
  const abbr = words(title)
  if (!full.length || !abbr.length || abbr.length > full.length) return false

  // A whole word matches its counterpart the way the document checks compare
  // names: spelling varies — Rahman and Rahmaan are one surname — so this is
  // sound-alike and near-miss, not equality.
  const sameWord = (a: string, b: string) =>
    a === b || similarity(a, b) >= 0.82 || (phonetic(a) !== '' && phonetic(a) === phonetic(b))

  // Walk the title against the name in order, taking either a whole word or
  // its initial. The surname must be spelled out: initials alone are not a name.
  let i = 0
  let wholeWords = 0
  for (const part of abbr) {
    let took = 0
    while (i < full.length && took === 0) {
      if (part.length === 1 && full[i]!.startsWith(part)) took = 1
      else if (part.length > 1 && sameWord(full[i]!, part)) took = 1
      // A counter clerk types the name as one word: "Monis Ur" becomes
      // "MONASUR", which sounds identical and matches nothing token by token.
      else if (part.length > 1 && i + 1 < full.length && sameWord(full[i]! + full[i + 1]!, part))
        took = 2
      else i++
    }
    if (!took) return false
    if (part.length > 1) wholeWords++
    i += took
  }
  return wholeWords > 0 && abbr[abbr.length - 1]!.length > 1
}

export type WalletCheck =
  | { outcome: 'pass'; rail: string; title: string }
  | { outcome: 'fail'; titles: { rail: string; title: string }[] }
  | { outcome: 'unavailable'; reason: string }

/** Asks both rails about one number, and accepts either. */
export async function checkWallet(phone: string, cnicName: string): Promise<WalletCheck> {
  if (!rizqReady()) return { outcome: 'unavailable', reason: 'not configured' }

  let auth = await token()
  if (!auth) return { outcome: 'unavailable', reason: 'could not authenticate' }

  const account = localNumber(phone)
  const found: { rail: string; title: string }[] = []
  /**
   * Whether either rail actually told us something. Code 00 means "cannot
   * verify, or your credentials are wrong" — it is not a statement about the
   * rider. Counting it as a mismatch puts a cross on a recruiter's screen that
   * nothing tested, which is worse than leaving the field blank.
   */
  let answered = false

  for (const { rail, bankId } of RAILS) {
    let got = await titleFetch(bankId, account, auth)
    if (got && !got.ok && got.stale) {
      // A stale token. Re-authenticate once, then try this rail again.
      auth = (await token(true)) ?? auth
      got = await titleFetch(bankId, account, auth)
    }
    if (!got) continue

    if (got.ok) {
      answered = true
      found.push({ rail, title: got.title })
      if (titleMatches(cnicName, got.title)) return { outcome: 'pass', rail, title: got.title }
    } else if (!got.stale && got.code === '00') {
      // Ambiguous by design: "cannot verify" and "bad credentials" share it.
      console.error(`rizq ${rail}: code 00 — cannot verify, or the credentials are wrong`)
    } else if (!got.stale) {
      // A definite answer that is not a title: the number is not an account on
      // this rail. That is a real finding.
      answered = true
    }
  }

  if (!answered)
    return { outcome: 'unavailable', reason: 'neither rail could verify the number' }
  return { outcome: 'fail', titles: found }
}
