import { createHmac, timingSafeEqual } from 'node:crypto'
import { Agent, fetch } from 'undici'

const VERSION = process.env.WHATSAPP_API_VERSION ?? 'v21.0'
const TOKEN = process.env.WHATSAPP_TOKEN ?? ''
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? ''
export const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? ''
/** Public origin, so media can be sent to WhatsApp by link. */
export const PUBLIC_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '')

export const whatsappReady = Boolean(TOKEN && PHONE_ID)

const agent = new Agent({ keepAliveTimeout: 60_000, connections: 16 })
/** Overridable so the whole flow can be exercised against a stub locally. */
const GRAPH = (process.env.WHATSAPP_GRAPH_URL ?? 'https://graph.facebook.com').replace(/\/$/, '')
const graph = (path: string) => `${GRAPH}/${VERSION}/${path}`

/**
 * Meta signs every webhook body. Without this check anyone who learns the URL
 * can drive a rider's application, so an unverifiable request is refused rather
 * than trusted.
 */
export function validSignature(raw: string, header: string | undefined): boolean {
  if (!APP_SECRET) return false
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', APP_SECRET).update(raw).digest('hex')
  const a = Buffer.from(header.slice(7))
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function send(payload: Record<string, unknown>): Promise<boolean> {
  if (!whatsappReady) return false
  try {
    const res = await fetch(graph(`${PHONE_ID}/messages`), {
      method: 'POST',
      dispatcher: agent,
      signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    })
    if (!res.ok) {
      console.error('whatsapp: send failed', res.status, (await res.text()).slice(0, 300))
      return false
    }
    return true
  } catch (err) {
    console.error('whatsapp: send error', err instanceof Error ? err.message : err)
    return false
  }
}

export const sendText = (to: string, body: string) =>
  send({ to, type: 'text', text: { preview_url: false, body } })

export const sendImage = (to: string, link: string) =>
  send({ to, type: 'image', image: { link } })

/** Ogg/Opus arrives as a playable voice note, which is what the welcome is. */
export const sendAudio = (to: string, link: string) =>
  send({ to, type: 'audio', audio: { link } })

export const markRead = (to: string, messageId: string) =>
  send({ status: 'read', message_id: messageId, to })

/** Media arrives as an id; the bytes take two authenticated calls to reach. */
export async function downloadMedia(
  id: string,
): Promise<{ bytes: Uint8Array; mime: string; name: string } | null> {
  if (!whatsappReady) return null
  try {
    const meta = await fetch(graph(id), {
      dispatcher: agent,
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!meta.ok) return null
    const info = (await meta.json()) as { url?: string; mime_type?: string }
    if (!info.url) return null

    const file = await fetch(info.url, {
      dispatcher: agent,
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(60_000),
    })
    if (!file.ok) return null

    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = info.mime_type?.split(';')[0]?.trim() ?? 'application/octet-stream'
    return { bytes, mime, name: `${id}` }
  } catch (err) {
    console.error('whatsapp: media download failed', err instanceof Error ? err.message : err)
    return null
  }
}
