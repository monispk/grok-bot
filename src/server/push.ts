/**
 * Sending an application to the backend, without the rider waiting for it.
 *
 * Two rules shape this. The rider's conversation must never block on someone
 * else's server — a rider mid-question does not care that a webhook is slow,
 * and losing them to a spinner costs more than the push is worth. And nothing
 * may be lost: an application half-collected and never delivered is the one
 * failure that cannot be redone, because the rider has gone.
 *
 * So every change is written to Postgres first and queued second. A worker
 * drains the queue in the background, retrying with a widening delay, and each
 * field is marked as delivered only when the backend has acknowledged it. What
 * is still owed is therefore always answerable from the database alone: it is
 * the difference between what the application says now and what `pushed` says
 * was last accepted.
 */
import { createHash, randomUUID } from 'node:crypto'
import { query } from './db.ts'
import { get as getUpload } from './uploads.ts'

const ENDPOINT = (process.env.ROZEENA_ENDPOINT ?? '').replace(/\/+$/, '')
const TOKEN = process.env.ROZEENA_TOKEN ?? ''
const TIMEOUT = Number(process.env.ROZEENA_TIMEOUT_SECONDS ?? 20) * 1000
/** Past this many tries a row is left alone for a person to look at. */
const MAX_ATTEMPTS = 12

export const pushReady = () => Boolean(ENDPOINT)

/**
 * The application as a flat map of fields.
 *
 * Flattened because delivery is tracked field by field: "which of these has
 * the backend seen?" has no answer if the unit is a nested object that changes
 * whenever any part of it does.
 */
export function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}) {
  if (value === null || value === undefined) return out
  if (Array.isArray(value) || typeof value !== 'object') {
    if (prefix) out[prefix] = value
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

/** Fields whose value differs from what the backend last acknowledged. */
export function delta(
  now: Record<string, unknown>,
  sent: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(now)) {
    if (JSON.stringify(v) !== JSON.stringify(sent[k])) out[k] = v
  }
  return out
}

/** Things the backend has no business receiving, and things it cannot use. */
const PRIVATE = /^(resume|sentBranch|payRetried|applicationId)(\.|$)/

export function forBackend(flow: Record<string, unknown>): Record<string, unknown> {
  const flat = flatten(flow)
  for (const k of Object.keys(flat)) if (PRIVATE.test(k)) delete flat[k]
  return flat
}

type Row = { id: string; pushed: Record<string, unknown> }

/**
 * Queues whatever the backend has not seen. Called after the application is
 * saved, and returns as soon as the row is written — the sending is the
 * worker's problem.
 */
export async function queueFields(
  id: string,
  flow: Record<string, unknown>,
  known?: Record<string, unknown>,
): Promise<number> {
  if (!pushReady()) return 0
  let sent = known
  if (!sent) {
    const rows = await query<Row>(`SELECT id, pushed FROM applications WHERE id = $1`, [id])
    sent = rows?.[0]?.pushed ?? {}
  }
  const changed = delta(forBackend(flow), sent)
  const names = Object.keys(changed)
  if (!names.length) return 0

  await query(
    `INSERT INTO outbox (application, endpoint, idempotency, body, kind, fields)
     VALUES ($1, $2, $3, $4, 'fields', $5)
     ON CONFLICT (idempotency) DO NOTHING`,
    [
      id,
      `/v1/applications/${id}`,
      // The same change queued twice is the same delivery, so the key is the
      // content rather than the moment: a retry after a crash cannot duplicate.
      `${id}:fields:${createHash('sha256').update(JSON.stringify(changed)).digest('hex').slice(0, 32)}`,
      JSON.stringify({ applicationId: id, fields: changed }),
      JSON.stringify(names),
    ],
  )
  return names.length
}

/** Queues a document. The bytes are read at send time, not held in the row. */
export async function queueDocument(
  id: string,
  uploadId: string,
  kind: string,
  verification: unknown,
): Promise<void> {
  if (!pushReady()) return
  await query(
    `INSERT INTO outbox (application, endpoint, idempotency, body, kind, fields)
     VALUES ($1, $2, $3, $4, 'document', $5)
     ON CONFLICT (idempotency) DO NOTHING`,
    [
      id,
      `/v1/applications/${id}/documents`,
      `${id}:doc:${uploadId}`,
      JSON.stringify({ applicationId: id, uploadId, kind, verification }),
      JSON.stringify([`documents.${kind}`]),
    ],
  )
}

type Due = {
  id: string
  application: string
  endpoint: string
  idempotency: string
  body: Record<string, unknown>
  kind: string
  fields: string[]
  attempts: number
}

/** Widening delay, capped: a backend that is down for an hour is not hammered. */
const backoff = (attempts: number) => Math.min(2 ** attempts, 900) * 1000

async function send(row: Due): Promise<{ ok: boolean; status: number; detail: string }> {
  const url = `${ENDPOINT}${row.endpoint}`
  const headers: Record<string, string> = {
    'idempotency-key': row.idempotency,
    ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
  }
  try {
    let res: Response
    if (row.kind === 'document') {
      const upload = getUpload(String(row.body['uploadId'] ?? ''))
      if (!upload)
        // The bytes are gone — held for thirty minutes and not forwarded in
        // time. The backend is told what was checked; the picture itself is
        // beyond recovery, and saying so is better than retrying forever.
        return { ok: true, status: 410, detail: 'the document is no longer held' }
      const form = new FormData()
      form.append('applicationId', String(row.body['applicationId'] ?? ''))
      form.append('kind', String(row.body['kind'] ?? ''))
      form.append('sha256', createHash('sha256').update(upload.bytes).digest('hex'))
      form.append('verification', JSON.stringify(row.body['verification'] ?? null))
      form.append('file', new Blob([upload.bytes as BlobPart], { type: upload.mime }), upload.name)
      res = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(TIMEOUT) })
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...row.body, sentAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(TIMEOUT),
      })
    }
    const text = (await res.text()).slice(0, 300)
    // 4xx other than 408/429 will not succeed on a retry, so they are recorded
    // and dropped rather than queued forever behind a payload the backend has
    // already refused.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
    return { ok: res.ok || permanent, status: res.status, detail: res.ok ? 'ok' : text }
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : 'failed' }
  }
}

/** Marks the fields a delivered row carried as acknowledged. */
async function acknowledge(row: Due) {
  if (row.kind !== 'fields') {
    await query(
      `UPDATE applications
         SET pushed_at = pushed_at || $2::jsonb
       WHERE id = $1`,
      [row.application, JSON.stringify(Object.fromEntries(row.fields.map((f) => [f, new Date().toISOString()])))],
    )
    return
  }
  const carried = (row.body['fields'] ?? {}) as Record<string, unknown>
  await query(
    `UPDATE applications
       SET pushed = pushed || $2::jsonb,
           pushed_at = pushed_at || $3::jsonb
     WHERE id = $1`,
    [
      row.application,
      JSON.stringify(carried),
      JSON.stringify(Object.fromEntries(Object.keys(carried).map((f) => [f, new Date().toISOString()]))),
    ],
  )
}

let draining = false

/** One pass over what is due. Safe to call often; it will not overlap itself. */
export async function drain(limit = 20): Promise<{ sent: number; failed: number }> {
  if (!pushReady() || draining) return { sent: 0, failed: 0 }
  draining = true
  let sent = 0
  let failed = 0
  try {
    const due = await query<Due>(
      `SELECT id, application, endpoint, idempotency, body, kind, fields, attempts
         FROM outbox
        WHERE next_attempt <= now() AND attempts < $2
        ORDER BY id
        LIMIT $1`,
      [limit, MAX_ATTEMPTS],
    )
    for (const row of due ?? []) {
      const result = await send(row)
      if (result.ok) {
        await acknowledge(row)
        await query(`DELETE FROM outbox WHERE id = $1`, [row.id])
        sent++
      } else {
        failed++
        await query(
          `UPDATE outbox
              SET attempts = attempts + 1,
                  next_attempt = now() + ($2 || ' milliseconds')::interval,
                  last_error = $3
            WHERE id = $1`,
          [row.id, backoff(row.attempts + 1), `${result.status}: ${result.detail}`],
        )
      }
    }
  } finally {
    draining = false
  }
  if (sent || failed) {
    console.log(`push: ${sent} delivered, ${failed} deferred`)
    await pending()
  }
  return { sent, failed }
}

/**
 * The last known depth of the queue, kept here so the health check can report
 * it without a database round trip — Railway polls that endpoint continuously.
 */
let depth = { rows: 0, stuck: 0 }
export const queueDepth = () => depth

/** What is still owed, for the health check and for anyone asking. */
export async function pending(): Promise<{ rows: number; stuck: number }> {
  const rows = await query<{ total: string; stuck: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE attempts >= $1) AS stuck
       FROM outbox`,
    [MAX_ATTEMPTS],
  )
  depth = { rows: Number(rows?.[0]?.total ?? 0), stuck: Number(rows?.[0]?.stuck ?? 0) }
  return depth
}

/**
 * Queues everything the backend has never seen.
 *
 * Nothing is queued while there is nowhere to send it, so the day the endpoint
 * is configured the outbox is empty — and an application finished the week
 * before would otherwise sit in Postgres forever, because only a *change*
 * queues anything and a finished application never changes again.
 *
 * So the difference between what each application says and what the backend
 * has acknowledged is queued directly. Run at boot and on a slow timer: rows
 * already delivered produce an empty delta and cost nothing, so it is safe to
 * run as often as it likes.
 */
export async function backfill(days = 60, limit = 500): Promise<number> {
  if (!pushReady()) return 0
  const rows = await query<{ id: string; flow: Record<string, unknown>; pushed: Record<string, unknown> }>(
    `SELECT id, flow, pushed FROM applications
      WHERE updated_at > now() - ($1 || ' days')::interval
      ORDER BY updated_at DESC
      LIMIT $2`,
    [days, limit],
  )
  let queued = 0
  for (const row of rows ?? []) queued += await queueFields(row.id, row.flow, row.pushed ?? {})
  if (queued) console.log(`push: backfilled ${queued} field(s) the backend had never seen`)
  return queued
}

export function startPushing(everyMs = 5000, sweepMs = 10 * 60_000) {
  if (!pushReady()) {
    // Nothing is queued either, so setting the endpoint later needs the
    // backfill above — which is why a restart is part of turning this on.
    console.log('push: no ROZEENA_ENDPOINT, applications stay in postgres only')
    return
  }
  console.log(`push: sending to ${ENDPOINT}`)
  setInterval(() => void drain(), everyMs).unref()
  // Once shortly after boot, then slowly: the first catches everything
  // collected before the endpoint existed, the rest catches anything a crash
  // left unqueued.
  setTimeout(() => void backfill(), 10_000).unref()
  setInterval(() => void backfill(), sweepMs).unref()
}
