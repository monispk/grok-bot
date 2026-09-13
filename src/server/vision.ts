/**
 * Reads a document by looking at it, when reading its labels was not enough.
 *
 * The local OCR is fast, free and good at a Punjab licence photographed in
 * decent light. It is label-matching underneath, so it needs to have been
 * taught each card's wording and layout — and riders will arrive with Sindh,
 * KPK, Balochistan, ICT, AJK and Gilgit-Baltistan cards, old laminate beside
 * new plastic, some labelled in Urdu. Teaching it seven formats means
 * discovering each one by refusing a real rider's licence, which is how the
 * Punjab card taught us that a glare spot on the heading could veto a card
 * whose every field had been read correctly.
 *
 * A vision model needs none of that: it reads the card the way a person does.
 * So it is the second pass, not the first — the common case stays free, and
 * this runs only when the cheap reader could not make sense of what it saw.
 *
 * On Groq, on the key the chat already uses. Measured at roughly 1,300 prompt
 * tokens for a document this size, against gpt-4o-mini's 25,500.
 */
import { Agent, fetch } from 'undici'

const BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'
const KEY = process.env.GROQ_API_KEY ?? ''
const MODEL = process.env.VISION_MODEL ?? 'qwen/qwen3.8-27b'
const TIMEOUT = Number(process.env.VISION_TIMEOUT_SECONDS ?? 30) * 1000

/** Groq will not take an unbounded image, and a rider's photo is already shrunk. */
const MAX_BYTES = 4 * 1024 * 1024

export const visionReady = () => Boolean(KEY && process.env.VISION_ENABLED !== 'false')

const agent = new Agent({ keepAliveTimeout: 30_000, connections: 8 })

/**
 * What a licence says, or null where the card does not say it.
 *
 * `isLicence` is the question that matters most: a rider who sends their CNIC
 * at the licence step must still be asked again, so a reader that extracts
 * fields from anything would be worse than the one it replaces.
 */
export type LicenceRead = {
  isLicence: boolean
  authority: string | null
  name: string | null
  number: string | null
  cnic: string | null
  expiry: string | null
  readable: boolean
}

const PROMPT = `You are reading a photograph of an identity document from Pakistan.

Decide first whether it is a DRIVING LICENCE — issued by a traffic police or
licensing authority of any Pakistani province or territory (Punjab, Sindh,
Khyber Pakhtunkhwa, Balochistan, Islamabad, Azad Jammu & Kashmir, Gilgit-
Baltistan). A CNIC / National Identity Card is NOT a driving licence. Nor is a
vehicle registration book, a utility bill, or a photograph of a person.

Then read what the card shows. Reply with JSON only:

{
  "is_licence": boolean,
  "authority": string | null,   // e.g. "Traffic Police, Punjab"
  "name": string | null,        // the holder's name, exactly as printed
  "number": string | null,      // the licence number, exactly as printed
  "cnic": string | null,        // 13 digits, no dashes
  "expiry": string | null,      // ISO "YYYY-MM-DD"
  "readable": boolean           // false if too blurred, dark or cropped to read
}

Rules:
- Never guess. A field you cannot clearly see is null.
- Labels may be in English or Urdu; the values are what matter.
- Do not translate or tidy the name: copy the characters printed on the card.
- If it is not a driving licence, set is_licence false and every field null.`

export async function readLicence(
  bytes: Uint8Array,
  mime: string,
): Promise<LicenceRead | null> {
  if (!visionReady()) return null
  if (!mime.startsWith('image/') || bytes.length > MAX_BYTES) return null

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
        max_completion_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      console.error('vision:', res.status, (await res.text()).slice(0, 200))
      return null
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; total_tokens?: number }
    }
    const text = body.choices?.[0]?.message?.content ?? ''
    if (!text) return null
    console.log(`vision: ${MODEL} read a licence, ${body.usage?.total_tokens ?? '?'} tokens`)
    return shape(JSON.parse(text) as Record<string, unknown>)
  } catch (err) {
    console.error('vision:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Only what the card can actually have said. A model's stray field is dropped. */
export function shape(raw: Record<string, unknown>): LicenceRead {
  const str = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'n/a' ? s : null
  }
  const digits = str(raw['cnic'])?.replace(/\D/g, '') ?? ''
  const expiry = str(raw['expiry'])
  return {
    isLicence: raw['is_licence'] === true,
    authority: str(raw['authority']),
    name: str(raw['name']),
    number: str(raw['number']),
    // Thirteen digits or nothing: a partial one would fail the comparison
    // against the CNIC card for a reason nobody could trace.
    cnic: digits.length === 13 ? digits : null,
    expiry: expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null,
    // A model that read nothing at all has not read a card, whatever it says.
    readable: raw['readable'] !== false,
  }
}
