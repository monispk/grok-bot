/**
 * Rozee's two identity services: reading a CNIC, and matching a face to it.
 *
 * Both answer the same three-way question, and the third answer is the one
 * that matters. "This document is wrong" and "the service did not reply" look
 * identical if you only return a boolean, and conflating them rejects riders
 * for our outage. A rider turned away by a timeout is a rider lost for nothing,
 * so `unavailable` passes them through for a person to check in the branch.
 */
export type Verdict<T> =
  | { outcome: 'pass'; fields: T; score?: number; latency: number }
  | { outcome: 'fail'; reason: string; score?: number; latency: number }
  | { outcome: 'unavailable'; reason: string; latency: number }

const OCR_URL = process.env.WA_OCR_API_URL ?? 'https://secure.rozee.pk/rest/api/ocr'
const OCR_ID = process.env.WA_OCR_APP_ID ?? ''
const OCR_KEY = process.env.WA_OCR_APP_KEY ?? ''

const FACIAL_URL = process.env.WA_FACIAL_API_URL ?? 'https://secure.rozee.pk/rest/api/facial'
const FACIAL_ID = process.env.WA_FACIAL_APP_ID ?? ''
const FACIAL_KEY = process.env.WA_FACIAL_APP_KEY ?? ''
const MIN_SIMILARITY = Number(process.env.FACIAL_MIN_SIMILARITY ?? 60)

export const ocrReady = () => Boolean(OCR_ID && OCR_KEY)
export const facialReady = () => Boolean(FACIAL_ID && FACIAL_KEY)

/**
 * Posts a form and insists on JSON coming back.
 *
 * The status code is not the test: a misconfigured URL on this host answers
 * 200 with an HTML error page, which parses as a perfectly successful failure.
 */
async function post(
  url: string,
  headers: Record<string, string>,
  form: Record<string, string>,
  timeoutMs: number,
): Promise<{ json: Record<string, unknown> | null; latency: number; reason?: string }> {
  const began = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    const latency = Date.now() - began
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      if (!res.ok) return { json: null, latency, reason: `http ${res.status}` }
      return { json, latency }
    } catch {
      return { json: null, latency, reason: `not json (http ${res.status})` }
    }
  } catch (err) {
    return {
      json: null,
      latency: Date.now() - began,
      reason: err instanceof Error ? err.message : 'request failed',
    }
  }
}

/**
 * Both services answer in the same envelope, with the verdict in a code rather
 * than the HTTP status:
 *
 *   {"success":"Y","response":{"code":"11","msg":"success","data":{…}},"errCode":"11"}
 *
 * 11 is a real answer. 05 is a real rejection — "Not a valid front side", which
 * is far better than inferring one from a missing field. 00 is the ambiguous
 * one the integration notes warn about: it means either "cannot verify" or
 * "your credentials are wrong", so it is logged loudly and never counted
 * against the rider.
 */
type Envelope = {
  code: string
  msg: string
  data: Record<string, unknown>
}

function unwrap(json: Record<string, unknown>): Envelope {
  const res = (json['response'] as Record<string, unknown>) ?? {}
  return {
    code: String(res['code'] ?? json['errCode'] ?? ''),
    msg: String(res['msg'] ?? ''),
    data: (res['data'] as Record<string, unknown>) ?? {},
  }
}

const pick = (o: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

const digits = (v: string | null) => (v ? v.replace(/[^0-9]/g, '') : '')

export type CnicFields = { name: string | null; cnic: string | null; father: string | null }

/** Reads the printed face of a CNIC. The back is a different document entirely. */
export async function readCnicFront(bytes: Uint8Array): Promise<Verdict<CnicFields>> {
  if (!ocrReady()) return { outcome: 'unavailable', reason: 'no credentials', latency: 0 }

  const { json, latency, reason } = await post(
    `${OCR_URL}/single`,
    { appId: OCR_ID, appKey: OCR_KEY },
    { cnic_image_front: Buffer.from(bytes).toString('base64') },
    8000,
  )
  if (!json) {
    console.error('rozee ocr:', reason)
    return { outcome: 'unavailable', reason: reason ?? 'no answer', latency }
  }

  const { code, msg, data } = unwrap(json)
  if (code === '00') {
    console.error('rozee ocr: code 00 — cannot verify, or the credentials are wrong')
    return { outcome: 'unavailable', reason: 'code 00 (ambiguous)', latency }
  }
  if (code !== '11')
    return { outcome: 'fail', reason: msg || `code ${code}`, latency }

  const fields: CnicFields = {
    name: pick(data, 'name', 'full_name', 'holder_name'),
    cnic: digits(pick(data, 'cnic', 'cnic_number', 'identity_number')) || null,
    father: pick(data, 'father_name', 'fatherName'),
  }

  // A success with no number on it is not a usable read.
  if (!fields.cnic || fields.cnic.length !== 13)
    return { outcome: 'fail', reason: 'no CNIC number in the reading', latency }

  return { outcome: 'pass', fields, latency }
}

export type FaceFields = { similarity: number }

/** Matches a selfie against the photograph printed on the CNIC. */
export async function matchFace(
  cnicFront: Uint8Array,
  selfie: Uint8Array,
): Promise<Verdict<FaceFields>> {
  if (!facialReady()) return { outcome: 'unavailable', reason: 'no credentials', latency: 0 }

  const { json, latency, reason } = await post(
    FACIAL_URL,
    { appId: FACIAL_ID, appKey: FACIAL_KEY },
    {
      cnic_image_front: Buffer.from(cnicFront).toString('base64'),
      selfie: Buffer.from(selfie).toString('base64'),
    },
    30_000,
  )
  if (!json) {
    console.error('rozee facial:', reason)
    return { outcome: 'unavailable', reason: reason ?? 'no answer', latency }
  }

  const { code, msg, data } = unwrap(json)
  if (code === '00') {
    console.error('rozee facial: code 00 — cannot verify, or the credentials are wrong')
    return { outcome: 'unavailable', reason: 'code 00 (ambiguous)', latency }
  }
  if (code !== '11')
    return { outcome: 'unavailable', reason: msg || `code ${code}`, latency }

  const raw = pick(data, 'similarity_score', 'similarity', 'score')
  const score = raw === null ? NaN : Number(raw)
  if (!Number.isFinite(score))
    return { outcome: 'unavailable', reason: 'no similarity in the reply', latency }

  return score >= MIN_SIMILARITY
    ? { outcome: 'pass', fields: { similarity: score }, score, latency }
    : { outcome: 'fail', reason: `similarity ${score.toFixed(1)} below ${MIN_SIMILARITY}`, score, latency }
}
