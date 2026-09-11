import { createHash } from 'node:crypto'

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
 * unguessable id and is open, because WhatsApp media is fetched by Meta rather
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

/** The audio for an id, if it has been synthesised and not yet evicted. */
export const audioFor = (id: string): Speech | null => cache.get(id) ?? null

/**
 * Says a line and returns the id it can be fetched by. The id is derived from
 * the words, so the same line costs one Uplift call however often it is said,
 * and a reloaded page asks for the same URL it had before.
 */
export async function speak(text: string): Promise<string | null> {
  const t = text.trim()
  if (!speechReady() || !t || t.length > MAX_CHARS) return null

  const id = digest(t)
  if (cache.has(id)) return id

  try {
    const res = await fetch(`${BASE}/synthesis/text-to-speech`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ voiceId: VOICE, text: t, outputFormat: FORMAT }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error('uplift:', res.status, (await res.text()).slice(0, 300))
      return null
    }
    const mime = res.headers.get('content-type') ?? 'audio/mpeg'
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!bytes.length) return null

    // Oldest out first; a Map iterates in insertion order.
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
    cache.set(id, { bytes, mime })
    return id
  } catch (err) {
    console.error('uplift:', err instanceof Error ? err.message : err)
    return null
  }
}
