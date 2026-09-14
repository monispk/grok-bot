/**
 * Our application, in the shape the Rozeena ingest API takes.
 *
 * Kept apart from the sending so it can be read and tested as what it is: a
 * translation. Their names are not ours — a rider who said "haan" to the bike
 * question is `missing: []` here and `collected.bike: "haan"` there — and the
 * translation is where that lives, not scattered through the delivery code.
 */
import { STEP_SPECS } from '../shared/steps.ts'
import { asMessages, type Entry } from './thread.ts'

export type Phase = 'collecting' | 'validating' | 'complete' | 'abandoned'

export type Ingest = {
  applicationId?: string
  submission_id?: number
  from_number?: string
  candidate_name?: string
  phase?: Phase
  current_step?: number
  collected?: Record<string, unknown>
  validation_results?: Record<string, unknown>
  candidate_lat?: number
  candidate_lng?: number
  candidate_city?: string
  fee_order_id?: string
  messages?: Entry[]
}

const YES = 'haan'
const NO = 'nahi'

const stepIndex = (id: string) => STEP_SPECS.findIndex((s) => s.id === id)

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const CITY: Record<string, string> = { f8: 'Islamabad', saddar: 'Rawalpindi' }

/**
 * Everything we hold about one rider, as one ingest payload.
 *
 * Always the whole picture, never a patch. What has changed since their last
 * acknowledgement is worked out afterwards, against this — building a patch
 * here would mean two places that both decide what a field means.
 */
export function ingestBody(
  id: string,
  flow: Record<string, unknown>,
  history: unknown[],
): Ingest {
  const c = (flow['collected'] ?? {}) as Record<string, string>
  const missing = (flow['missing'] ?? []) as string[]
  const payment = (flow['payment'] ?? null) as Record<string, unknown> | null
  const quiz = (flow['quiz'] ?? null) as Record<string, unknown> | null
  const step = num(flow['step']) ?? 0
  const branch = typeof flow['branch'] === 'string' ? flow['branch'] : ''

  /**
   * A yes-or-no gate the rider has already passed.
   *
   * Answered "no" is recorded as the step's name in `missing`; answered "yes"
   * is recorded as nothing at all, so the only way to tell yes from
   * not-yet-asked is how far through they are.
   */
  const gate = (name: string): string | undefined =>
    step > stepIndex(name) ? (missing.includes(name) ? NO : YES) : undefined

  const collected: Record<string, unknown> = {
    full_name: flow['fullName'],
    first_name: flow['firstName'],
    phone: flow['phone'],
    cnic: flow['cnic'],
    smartphone: gate('smartphone'),
    bike: gate('bike'),
    wallet: flow['rail'],
    no_wallet: flow['noWallet'],
    missing: missing.length ? missing.join(', ') : undefined,
    office: c['gps.office'],
    branch: branch || undefined,
    licence_number: c['license.number'],
    licence_expiry: c['license.expiry'],
    licence_expired: c['license.expired'],
    licence_read_by: c['license.readBy'],
    name_on_licence: c['license.name'],
    name_on_cnic: c['cnic_front.name'],
    quiz_declined: quiz?.['declined'],
    quiz_answers: Array.isArray(quiz?.['answers']) && (quiz['answers'] as unknown[]).length
      ? (quiz['answers'] as { id: string; chose: string | null }[])
          .map((a) => `${a.id}:${a.chose ?? '-'}`)
          .join(' ')
      : undefined,
  }
  for (const k of Object.keys(collected))
    if (collected[k] === undefined || collected[k] === '') delete collected[k]

  /**
   * What we checked, and what we made of it.
   *
   * `front_cnic` sits under `identity_verification.detail` because that is the
   * field their dashboard searches a candidate by — put anywhere else, the
   * rider cannot be found by the number on their card.
   */
  const face = c['checks.faceMatch'] ?? ''
  const validation: Record<string, unknown> = {}

  if (flow['cnic'] || c['cnic_front.cnic'] || face)
    validation['identity_verification'] = {
      passed: face.startsWith('match'),
      detail: {
        front_cnic: c['cnic_front.cnic'] ?? flow['cnic'] ?? null,
        verified: face.startsWith('match'),
        name_on_cnic: c['cnic_front.name'] ?? null,
        face_match: face || null,
        licence_vs_cnic: c['checks.licenceVsCnic'] ?? null,
      },
    }

  if (c['license.number'] || c['license.expiry'])
    validation['licence'] = {
      // An expired card fails: the rider is not charged and is sent to the
      // office to come back once it is renewed.
      passed: c['license.expired'] !== 'true',
      detail: {
        number: c['license.number'] ?? null,
        expiry: c['license.expiry'] ?? null,
        expired: c['license.expired'] === 'true',
        read_by: c['license.readBy'] ?? 'local OCR',
        name: c['license.name'] ?? null,
      },
    }

  if (c['checks.wallet'] || flow['rail'])
    validation['wallet'] = {
      passed: (c['checks.wallet'] ?? '').startsWith('match'),
      detail: { rail: flow['rail'] ?? null, check: c['checks.wallet'] ?? null },
    }

  if (payment)
    validation['fee'] = {
      passed: payment['state'] === 'paid',
      detail: {
        state: payment['state'] ?? null,
        rail: payment['rail'] ?? null,
        amount_paisa: payment['amountPaisa'] ?? 0,
        reference: payment['ref'] ?? null,
        rail_said: payment['detail'] ?? null,
      },
    }

  const done = step >= STEP_SPECS.length || flow['ineligible'] === true
  const phase: Phase = done
    ? 'complete'
    : step >= stepIndex('license_front')
      ? 'validating'
      : 'collecting'

  const body: Ingest = {
    from_number: typeof flow['phone'] === 'string' ? flow['phone'] : undefined,
    candidate_name: typeof flow['fullName'] === 'string' ? flow['fullName'] : undefined,
    phase,
    current_step: step,
    collected,
    ...(Object.keys(validation).length ? { validation_results: validation } : {}),
    candidate_lat: num(c['gps.latitude']),
    candidate_lng: num(c['gps.longitude']),
    candidate_city: CITY[branch],
    fee_order_id: typeof payment?.['ref'] === 'string' && payment['ref'] ? payment['ref'] : undefined,
    messages: asMessages(history),
  }
  for (const k of Object.keys(body))
    if (body[k as keyof Ingest] === undefined) delete body[k as keyof Ingest]
  if (!body.messages?.length) delete body.messages
  return body
}

/**
 * The payload as a flat map, for working out what has changed.
 *
 * The conversation counts as one thing: sixty bubbles flattened would be two
 * hundred entries that all shift every time a rider says anything, and "which
 * of these have they seen?" would be answered wrongly for all of them. Their
 * API takes the transcript whole and ignores duplicates, so one key holding a
 * hash of it says exactly what is needed — it changed, or it did not.
 */
export function trackable(body: Ingest, hash: (s: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const walk = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value) || typeof value !== 'object') {
      if (prefix) out[prefix] = value
      return
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      walk(v, prefix ? `${prefix}.${k}` : k)
  }
  const { messages, ...rest } = body
  walk(rest, '')
  if (messages?.length) out['messages'] = hash(JSON.stringify(messages))
  return out
}

/** Rebuilds a nested payload from the dotted names that changed. */
export function unflatten(dotted: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(dotted)) {
    const parts = key.split('.')
    let at = out
    for (const p of parts.slice(0, -1)) {
      if (typeof at[p] !== 'object' || at[p] === null) at[p] = {}
      at = at[p] as Record<string, unknown>
    }
    at[parts[parts.length - 1]!] = value
  }
  return out
}
