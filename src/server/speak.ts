import { createHash } from 'node:crypto'
import { forSpeech } from './script.ts'
import { query } from './db.ts'

/**
 * Spoken answers, from Uplift AI.
 *
 * Every scripted line already has a recording. What the model writes cannot,
 * because nobody knew in advance what it would say — so a rider who reads
 * poorly got the questions read aloud but not the answers. This fills that gap
 * with the same voice the recordings use, so the bot does not change voice
 * halfway through a conversation.
 *
 * Synthesising and fetching are separate. Asking for speech costs an Uplift
 * call, so it is behind the same gate as the chat; fetching the result is by an
 * unguessable id and is open, because the clip is fetched by the rider's page rather
 * than by the rider. That way an open synthesiser is never left running on
 * someone else's account.
 */
const KEY = process.env.UPLIFT_API_KEY ?? ''
const VOICE = process.env.UPLIFT_VOICE_ID ?? ''
const FORMAT = process.env.UPLIFT_OUTPUT_FORMAT ?? 'MP3_22050_128'
const BASE = process.env.UPLIFT_BASE_URL ?? 'https://api.upliftai.org/v1'

export const speechReady = () => Boolean(KEY && VOICE)

/** Roughly two hundred answers, which is far more than one rider needs. */
const MAX_CACHED = 200
const MAX_CHARS = 1200

const digest = (text: string) =>
  createHash('sha256').update(text.trim()).digest('hex').slice(0, 16)

const cache = new Map<string, { bytes: Uint8Array; mime: string }>()

export type Speech = { bytes: Uint8Array; mime: string }

/**
 * The audio for an id. Memory first, then the database — a voice note's URL
 * lives in the rider's thread for as long as the conversation does, which is
 * longer than any one deploy.
 */
export async function audioFor(id: string): Promise<Speech | null> {
  const hot = cache.get(id)
  if (hot) return hot

  const rows = await query<{ mime: string; bytes: Buffer }>(
    `UPDATE speech SET used_at = now() WHERE id = $1 RETURNING mime, bytes`,
    [id],
  )
  const row = rows?.[0]
  if (!row) return null

  const found = { bytes: new Uint8Array(row.bytes), mime: row.mime }
  remember(id, found)
  return found
}

function remember(id: string, speech: Speech) {
  // Oldest out first; a Map iterates in insertion order.
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(id, speech)
}

/**
 * Says a line and returns the id it can be fetched by. The id is derived from
 * the words, so the same line costs one Uplift call however often it is said,
 * and a reloaded page asks for the same URL it had before.
 */
export async function speak(text: string): Promise<string | null> {
  const t = text.trim()
  if (!speechReady() || !t || t.length > MAX_CHARS) return null

  const id = digest(t)
  if (await audioFor(id)) return id

  // Uplift is given mixed script; the rider still reads the Roman Urdu.
  const spoken = await forSpeech(t)

  try {
    const res = await fetch(`${BASE}/synthesis/text-to-speech`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ voiceId: VOICE, text: spoken, outputFormat: FORMAT }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error('uplift:', res.status, (await res.text()).slice(0, 300))
      return null
    }
    const mime = res.headers.get('content-type') ?? 'audio/mpeg'
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!bytes.length) return null

    remember(id, { bytes, mime })
    await query(
      `INSERT INTO speech (id, mime, bytes, said) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET used_at = now()`,
      [id, mime, Buffer.from(bytes), spoken],
    )
    return id
  } catch (err) {
    console.error('uplift:', err instanceof Error ? err.message : err)
    return null
  }
}
