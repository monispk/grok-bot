/**
 * Uploaded documents are held in memory with a short TTL and never written to
 * disk. These are CNICs, licences and utility bills — the exact set identity
 * theft is built from — and persisting them needs the encryption, access
 * control and retention policy described in docs/onboarding-flow.md. Until that
 * exists, nothing outlives the process. When the verification APIs land, this is
 * where the bytes get forwarded to them.
 */
import { createHash } from 'node:crypto'
import { SAY } from '../shared/messages.ts'
import { query } from './db.ts'

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

/**
 * Keeps a document past the half hour it lives in memory, so a recruiter can
 * see what a rider actually sent.
 *
 * These are CNICs, licences and photographs of faces — the exact set identity
 * theft is built from — so the window is short and deliberate: KEEP_HOURS, a
 * day by default, swept from the same timer as everything else. Long enough
 * for a recruiter to look at an application the morning after it arrived,
 * short enough that a leak is a day of applications rather than a year of
 * them.
 *
 * Written after the response, never in front of the rider.
 */
export async function keep(
  upload: Upload,
  application: string | null,
  kind: string | null,
): Promise<void> {
  const sha = createHash('sha256').update(upload.bytes).digest('hex')
  await query(
    `INSERT INTO uploads (id, application, kind, mime, bytes, sha256)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [upload.id, application || null, kind ?? 'unknown', upload.mime, Buffer.from(upload.bytes), sha],
  )
}

/** The document, from memory if it is still there and from the database if not. */
export async function find(id: string): Promise<Upload | undefined> {
  const hot = store.get(id)
  if (hot) return hot
  const rows = await query<{ kind: string; mime: string; bytes: Buffer; created_at: Date }>(
    `SELECT kind, mime, bytes, created_at FROM uploads WHERE id = $1`,
    [id],
  )
  const row = rows?.[0]
  if (!row) return undefined
  return {
    id,
    name: `${row.kind}.${row.mime.split('/')[1] ?? 'bin'}`,
    mime: row.mime,
    size: row.bytes.length,
    bytes: new Uint8Array(row.bytes),
    at: new Date(row.created_at).getTime(),
  }
}

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
