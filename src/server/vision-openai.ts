/**
 * The reader for a driving licence. The only one.
 *
 * There were three — label matching on a local OCR, then qwen, then this, each
 * covering for the last — and between them they still got a licence wrong
 * often enough to matter. Every card has one number and one date that decide
 * anything, and a reader that is right about them most of the time is a reader
 * that sends real riders away and waves expired cards through. Cheapness is
 * not worth much when the answer is acted on.
 *
 * It costs a fraction of a cent per card and takes two to four seconds.
 *
 * The schema and the prompt are from the integration notes supplied with the
 * key, with their reasoning kept: every field is required and an empty string
 * means "could not read it", never "the card does not have one". A guessed
 * name wrongly rejects a real applicant; an empty one costs nothing.
 */
import { Agent, fetch } from 'undici'

/**
 * What a licence says, or null where the card does not say it.
 *
 * `isLicence` is the question that matters most: a rider who sends their CNIC
 * at the licence step must still be asked again, so a reader that extracts
 * fields from anything would be worse than no reader at all.
 */
export type LicenceRead = {
  isLicence: boolean
  name: string | null
  number: string | null
  cnic: string | null
  expiry: string | null
  readable: boolean
  /** A learner's permit rather than a full licence. Recorded, not acted on. */
  learner: boolean
}

const BASE = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const KEY = process.env.OPENAI_API_KEY ?? ''
const MODEL = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini'
const TIMEOUT = Number(process.env.OPENAI_VISION_TIMEOUT_SECONDS ?? 40) * 1000

/** Their limit is larger, but a rider's photograph is already shrunk. */
const MAX_BYTES = 8 * 1024 * 1024

export const licenceReaderReady = () =>
  Boolean(KEY && process.env.OPENAI_VISION_ENABLED !== 'false')

const agent = new Agent({ keepAliveTimeout: 30_000, connections: 4 })

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_driving_license',
    'unreadable',
    'holder_name',
    'license_number',
    'cnic_number',
    'expiry_date',
    'issue_date',
    'is_learner_permit',
  ],
  properties: {
    is_driving_license: {
      type: 'boolean',
      description:
        'True only if this is a driving licence/permit. False for a CNIC, passport, receipt, random photo, etc.',
    },
    unreadable: {
      type: 'boolean',
      description:
        'True if this IS a licence but is too blurry, cropped or dark to read the key fields.',
    },
    holder_name: {
      type: 'string',
      description: "The licence HOLDER's name only. Empty string if not clearly readable.",
    },
    license_number: { type: 'string', description: 'Licence/permit number, or empty string.' },
    cnic_number: {
      type: 'string',
      description:
        'The CNIC number printed on the licence, digits only, no dashes (13 digits). Empty string if not printed on the card or not readable. This is NOT the licence number.',
    },
    expiry_date: {
      type: 'string',
      description: 'Expiry/valid-until date as DD.MM.YYYY. Empty string if not printed or not readable.',
    },
    issue_date: { type: 'string', description: 'First issue date as DD.MM.YYYY, or empty string.' },
    is_learner_permit: {
      type: 'boolean',
      description: "True if this is a learner's permit rather than a full licence.",
    },
  },
} as const

const PROMPT = `This is a photo or scan of a Pakistani driving licence (or possibly some other document entirely). Extract the fields defined by the schema.

CRITICAL — holder_name must be the name of the PERSON the licence belongs to, usually printed next to a label such as 'Name'. It is NOT:
  - the issuing authority — e.g. 'Islamabad Capital Territory Police', 'Government of the Punjab', 'National Highways & Motorway Police', 'City Traffic Police'
  - a heading such as 'Driving License', 'Driving Licence', 'Permit', or 'Learner Permit'
  - the words next to a signature block such as 'Licensing Authority'
If you cannot clearly identify the holder's own name, return an empty string for holder_name — do NOT guess and do NOT substitute any of the above. An empty holder_name is treated as 'not readable', which is safe; a wrong name wrongly rejects a real applicant.

DATES — a licence typically shows several. Map them carefully:
  - expiry_date  <- 'Expiry Date', 'Valid Till', 'Valid Until', 'Validity'
  - issue_date   <- 'First Issue Date', 'Date of Issue'
  - Do NOT put the Date of Birth in either field. If a date is labelled 'Date of Birth', ignore it entirely.
Return dates as DD.MM.YYYY exactly as printed. Empty string if absent/unreadable.

CNIC — most Pakistani licences print the holder's CNIC number. Return it in cnic_number as 13 digits with no dashes or spaces. Do NOT confuse it with the licence/permit number, which is a different field. If no CNIC is printed on the card, or you cannot read every digit with confidence, return an empty string — a guessed digit is worse than no answer.

Set unreadable=true only when this IS a licence but the key fields genuinely cannot be read. A slightly rotated, scanned or lightly glared card that you can still read is NOT unreadable — extract from it.`

/** DD.MM.YYYY, as their schema asks for it, to the ISO the rest of this uses. */
export function isoDate(printed: string): string | null {
  const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(printed.trim())
  if (!m) return null
  const [, d, mo, y] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (Number.isNaN(date.getTime())) return null
  // A month that rolled over means the day was not real — 31.02.2027.
  if (date.getUTCMonth() !== Number(mo) - 1) return null
  return date.toISOString().slice(0, 10)
}

/** Their shape, as the rest of the code expects a licence to look. */
export function shapeOpenAi(raw: Record<string, unknown>): LicenceRead {
  const str = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    // Empty means "could not read it". Never "the card does not have one",
    // and never a reason to refuse anybody.
    return s ? s : null
  }
  const cnic = str(raw['cnic_number'])?.replace(/\D/g, '') ?? ''
  const printed = str(raw['expiry_date'])
  return {
    isLicence: raw['is_driving_license'] === true,
    name: str(raw['holder_name']),
    number: str(raw['license_number']),
    cnic: cnic.length === 13 ? cnic : null,
    expiry: printed ? isoDate(printed) : null,
    readable: raw['unreadable'] !== true,
    learner: raw['is_learner_permit'] === true,
  }
}

export async function readLicence(
  bytes: Uint8Array,
  mime: string,
): Promise<LicenceRead | null> {
  if (!licenceReaderReady() || bytes.byteLength > MAX_BYTES) return null

  try {
    const url = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      dispatcher: agent,
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'driving_license', strict: true, schema: SCHEMA },
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              // "high" detail: this is reached only for the cards the cheaper
              // readers could not manage, which are exactly the ones where the
              // difference between a 3 and an 8 is a few pixels.
              { type: 'image_url', image_url: { url, detail: 'high' } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      console.error('licence reader:', res.status, (await res.text()).slice(0, 200))
      return null
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { total_tokens?: number }
    }
    const text = body.choices?.[0]?.message?.content ?? ''
    if (!text) return null
    console.log(`licence reader: ${MODEL}, ${body.usage?.total_tokens ?? '?'} tokens`)
    return shapeOpenAi(JSON.parse(text) as Record<string, unknown>)
  } catch (err) {
    // A timeout is not a statement about the document. The card is accepted
    // unchecked rather than refused: never fail an applicant on our outage.
    console.error('licence reader:', err instanceof Error ? err.message : err)
    return null
  }
}
