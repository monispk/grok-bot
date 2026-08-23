/**
 * Uploaded documents are held in memory with a short TTL and never written to
 * disk. These are CNICs, licences and utility bills — the exact set identity
 * theft is built from — and persisting them needs the encryption, access
 * control and retention policy described in docs/onboarding-flow.md. Until that
 * exists, nothing outlives the process. When the verification APIs land, this is
 * where the bytes get forwarded to them.
 */
import { SAY } from '../shared/messages.ts'

export type Upload = {
  id: string
  name: string
  mime: string
  size: number
  bytes: Uint8Array
  at: number
}

const store = new Map<string, Upload>()
const TTL = 30 * 60_000
const MAX_FILE = 10 * 1024 * 1024 // 10 MB
const MAX_TOTAL = 200 * 1024 * 1024
let total = 0

export const ALLOWED: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
}

/** Trust the bytes, not the declared type — a mislabelled file is still wrong. */
function sniff(b: Uint8Array): string | null {
  if (b.length < 4) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  return null
}

export type Accepted = { ok: true; upload: Upload }
export type Rejected = { ok: false; reason: string }

export function accept(name: string, bytes: Uint8Array): Accepted | Rejected {
  if (bytes.length === 0) return { ok: false, reason: 'File khali hai.' }
  if (bytes.length > MAX_FILE)
    return { ok: false, reason: SAY.fileTooBig.text }

  const mime = sniff(bytes)
  if (!mime)
    return {
      ok: false,
      reason: SAY.badFileType.text,
    }

  sweep()
  if (total + bytes.length > MAX_TOTAL)
    return { ok: false, reason: 'Abhi jagah nahi hai. Thori dair baad koshish karein.' }

  const upload: Upload = {
    id: crypto.randomUUID(),
    name: name.slice(0, 120) || 'document',
    mime,
    size: bytes.length,
    bytes,
    at: Date.now(),
  }
  store.set(upload.id, upload)
  total += bytes.length
  return { ok: true, upload }
}

export const get = (id: string): Upload | undefined => store.get(id)

function sweep() {
  const cutoff = Date.now() - TTL
  for (const [id, u] of store) {
    if (u.at < cutoff) {
      store.delete(id)
      total -= u.size
    }
  }
}

setInterval(sweep, 60_000).unref()
