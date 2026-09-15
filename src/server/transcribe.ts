import { FormData } from 'undici'
import { forWhisper } from './audio.ts'
import { groqFetch } from './provider.ts'

/**
 * Speech to text, so a rider who cannot write can still answer.
 *
 * Whisper runs on Groq at the same origin as the chat model, which means the
 * same key and the same warm connection — a transcription costs one round trip,
 * not a fresh TLS handshake.
 */
const MODEL = process.env.WHISPER_MODEL ?? 'whisper-large-v3'
const LANGUAGE = process.env.WHISPER_LANGUAGE ?? 'ur'

/** Groq accepts 25 MB on the free tier; a spoken answer is far smaller. */
const MAX_BYTES = 20 * 1024 * 1024
const MIN_BYTES = 1024

/**
 * Nudges Whisper towards the words this bot actually hears. The prompt steers
 * vocabulary, so naming the documents makes them far likelier to come back
 * spelled correctly rather than as something phonetically close.
 */
const VOCABULARY =
  'foodpanda, rider, CNIC, shanakhti card, driving license, utility bill, bijli ka bill, selfie, location, smartphone, touch phone, haan, nahi.'

export type Transcript =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too-big' | 'unavailable' | 'silent' | 'unreadable' }

export async function transcribe(bytes: Uint8Array, mime: string): Promise<Transcript> {
  if (bytes.length < MIN_BYTES) return { ok: false, reason: 'empty' }
  if (bytes.length > MAX_BYTES) return { ok: false, reason: 'too-big' }

  // The container is read from the bytes and, where Whisper cannot decode it,
  // converted. The declared type is only a fallback for the extension.
  const ready = await forWhisper(bytes)
  if (!ready) return { ok: false, reason: 'unreadable' }
  if (ready.converted) console.log(`whisper: converted ${ready.kind} to wav`)

  try {
    const form = new FormData()
    // Whisper picks the decoder from the extension, so the name has to match the
    // container that was actually recorded.
    const name = ready.kind === 'unknown' ? filename(mime) : `speech.${ready.ext}`
    form.append('file', new Blob([ready.bytes as BlobPart]), name)
    form.append('model', MODEL)
    form.append('language', LANGUAGE)
    form.append('prompt', VOCABULARY)
    form.append('response_format', 'json')
    form.append('temperature', '0')

    const res = await groqFetch('/audio/transcriptions', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      console.error('whisper:', res.status, (await res.text()).slice(0, 300))
      return { ok: false, reason: 'unavailable' }
    }

    const json = (await res.json()) as { text?: string }
    const text = (json.text ?? '').trim()
    // Whisper answers a silent clip with an empty string, or occasionally with a
    // stray full stop. Neither is something to hand the flow as an answer.
    if (!text || /^[.…\s]*$/.test(text)) return { ok: false, reason: 'silent' }
    return { ok: true, text }
  } catch (err) {
    console.error('whisper:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'unavailable' }
  }
}

/** MediaRecorder emits webm on Chrome and mp4 on Safari; recorder apps send ogg. */
function filename(mime: string): string {
  const base = mime.split(';')[0]?.trim()
  const ext =
    base === 'audio/mp4' || base === 'audio/aac'
      ? 'm4a'
      : base === 'audio/ogg'
        ? 'ogg'
        : base === 'audio/mpeg'
          ? 'mp3'
          : base === 'audio/wav' || base === 'audio/x-wav'
            ? 'wav'
            : 'webm'
  return `speech.${ext}`
}
