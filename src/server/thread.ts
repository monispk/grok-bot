/**
 * The conversation, in the shape the ingest API asks for.
 *
 * The backend receives the *result* of an application — a name, a rail, what
 * the OCR read. Without the conversation those came out of, a rider's voice
 * notes are a pile of audio with nothing to put them back into.
 *
 * So every bubble becomes one message, in order, with the words that were
 * said. A voice note carries its transcript as the content and a URL to the
 * recording itself, because the ingest document endpoint takes images and PDFs
 * only — there is nowhere else for the audio to go.
 *
 * Deliberately not our own message format: `role` is theirs and happens to
 * match, but `kind`, `sources` and `src` are the web app's business and change
 * when the app changes.
 */

/**
 * Where our own uploads can be fetched from, for the audio links.
 *
 * Read when it is needed rather than when this module loads. A constant
 * captured at import time cannot be set by a test, and a value that cannot be
 * set by a test is a value nobody checks — which for this one means voice
 * notes arriving with no way to play them and nothing saying so.
 */
export const host = () =>
  (
    process.env.APP_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
  ).replace(/\/+$/, '')

/** One message as the app stores it. Everything is optional but the essentials. */
export type Stored = {
  role?: string
  content?: string
  kind?: string
  src?: string
  sources?: { src?: string; type?: string }[]
  doc?: { name?: string; mime?: string; size?: number }
  video?: string
  place?: { lat?: number; lng?: number; address?: string }
  at?: number
  seq?: number
}

export type Entry = {
  role: 'user' | 'assistant'
  /** The words: what was typed, what was said, or the label of the button tapped. */
  content: string
  type: 'text' | 'voice' | 'audio' | 'document' | 'image' | 'video' | 'location' | 'choice'
  /**
   * ISO 8601, always UTC, from the rider's own phone. Absent only on a bubble
   * that predates stamping.
   */
  at?: string
  /**
   * Where this message sits in the conversation, counting from one.
   *
   * `at` alone cannot order a thread: a batch of lines stamped together shares
   * a millisecond. This is given once when the bubble is created and never
   * changes, so it survives a reload and the trimming of older messages.
   */
  seq?: number
  /** A voice note, fetchable — the ingest document endpoint will not take audio. */
  audio_url?: string
  /** For a document, which one, so it lines up with the file sent separately. */
  kind?: string
  /** One of our own recordings, by name, for a line Rozeena spoke. */
  clip?: string
  video?: string
  place?: { lat?: number; lng?: number; address?: string }
}

/** The upload id out of a URL like `/api/upload/<uuid>`. */
export const uploadId = (url: string | undefined): string | undefined => {
  const m = /\/api\/upload\/([0-9a-f-]{36})/i.exec(url ?? '')
  return m?.[1]
}

/** The first source that is not a blob URL, which is where the audio lives. */
const audioSrc = (m: Stored): string | undefined =>
  [m.src, ...(m.sources ?? []).map((s) => s?.src)].find(
    (s): s is string => typeof s === 'string' && !s.startsWith('blob:'),
  )

/** A recording of ours, by file name — `/ask-full_name.opus` is `ask-full_name`. */
const clipName = (url: string | undefined): string | undefined => {
  if (!url || url.startsWith('/api/')) return undefined
  return url.replace(/^\//, '').replace(/\.(opus|m4a|mp3|jpg|png)$/, '') || undefined
}

/** Which document a bubble was, read off the file name the rider's camera gave it. */
const docKind = (m: Stored): string | undefined => {
  const name = (m.doc?.name ?? '').toLowerCase()
  if (name.includes('licen')) return 'license'
  if (name.includes('selfie')) return 'selfie'
  if (name.includes('cnic')) return 'cnic_front'
  return undefined
}

export function entry(m: Stored): Entry | null {
  const role = m.role === 'user' ? 'user' : 'assistant'
  // toISOString is UTC by definition — the Z is the point. A missing `at` is
  // the thing to avoid: the far end stamps those with its own local clock.
  const at = typeof m.at === 'number' ? new Date(m.at).toISOString() : undefined
  const content = (m.content ?? '').trim()
  const base = {
    role,
    ...(at ? { at } : {}),
    ...(typeof m.seq === 'number' ? { seq: m.seq } : {}),
  } as const

  if (m.kind === 'audio') {
    const src = audioSrc(m)
    // The rider's own voice. The link is what makes it playable at their end;
    // without one there is still the transcript, which is worth sending.
    if (role === 'user') {
      const id = uploadId(src)
      const at = host()
      return {
        ...base,
        type: 'voice',
        content,
        ...(id && at ? { audio_url: `${at}/api/upload/${id}` } : {}),
      }
    }
    // Ours. The file is not something they can fetch, but the bubble was there
    // and a log that silently drops half of Rozeena's turns reads oddly.
    return { ...base, type: 'audio', content, ...(clipName(src) ? { clip: clipName(src) } : {}) }
  }

  if (m.kind === 'document')
    return {
      ...base,
      type: 'document',
      content: m.doc?.name ?? content,
      ...(docKind(m) ? { kind: docKind(m) } : {}),
    }

  if (m.kind === 'choice') return { ...base, type: 'choice', content }
  if (m.kind === 'video' && m.video) return { ...base, type: 'video', content, video: m.video }
  if (m.kind === 'location')
    return { ...base, type: 'location', content, ...(m.place ? { place: m.place } : {}) }
  if (m.kind === 'image')
    return { ...base, type: 'image', content, ...(clipName(m.src) ? { clip: clipName(m.src) } : {}) }

  // Plain words. An empty one is a bubble that never filled — a spinner, or a
  // clip nothing was heard in — and is not part of the conversation.
  return content ? { ...base, type: 'text', content } : null
}

export function asMessages(history: unknown[]): Entry[] {
  return (history ?? [])
    .map((m) => entry((m ?? {}) as Stored))
    .filter((e): e is Entry => e !== null)
}
