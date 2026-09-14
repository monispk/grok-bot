/**
 * Sending an application to the Rozeena ingest API, without the rider waiting
 * for it.
 *
 * Two rules shape this. The rider's conversation must never block on someone
 * else's server — a rider mid-question does not care that an ingest is slow,
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
 *
 * Three things their API insists on, which the shape here exists to honour:
 * the first call carries `applicationId` and every call after it carries the
 * `submission_id` they hand back; fields must land before a document, which
 * gets a 409 otherwise; and deliveries for one application must not overlap,
 * or two partial updates overwrite each other.
 */
import { createHash } from 'node:crypto'
import { query } from './db.ts'
import { ingestBody, trackable, unflatten, type Ingest } from './ingest.ts'
import { host } from './thread.ts'
import { find as findUpload } from './uploads.ts'

const ENDPOINT = (process.env.ROZEENA_ENDPOINT ?? '').replace(/\/+$/, '')
/** Their header is `X-Ingest-Key`. The older name still works as the value. */
const KEY = process.env.ROZEENA_INGEST_KEY ?? process.env.ROZEENA_TOKEN ?? ''
const TIMEOUT = Number(process.env.ROZEENA_TIMEOUT_SECONDS ?? 20) * 1000
/** Past this many tries a row is left alone for a person to look at. */
const MAX_ATTEMPTS = 12

export const pushReady = () => Boolean(ENDPOINT)

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

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

/** The whole payload as we would send it today, and its flattened form. */
export function forBackend(
  id: string,
  flow: Record<string, unknown>,
  history: unknown[] = [],
): Record<string, unknown> {
  return trackable(ingestBody(id, flow, history), sha)
}

type Row = { id: string; pushed: Record<string, unknown>; submission_id: number | null }

const known = async (id: string): Promise<Row> => {
  const rows = await query<{ id: string; pushed: Record<string, unknown>; submission_id: unknown }>(
    `SELECT id, pushed, submission_id FROM applications WHERE id = $1`,
    [id],
  )
  const row = rows?.[0]
  return {
    id,
    pushed: row?.pushed ?? {},
    /*
     * A number, emphatically.
     *
     * Postgres `bigint` arrives from node-postgres as a *string*, so this went
     * out as "486" rather than 486 and their API refused every call after the
     * first — the one call that carries our own id instead. A rider's whole
     * application would have been one ingest deep.
     */
    submission_id: Number.isFinite(Number(row?.submission_id)) && row?.submission_id !== null
      ? Number(row?.submission_id)
      : null,
  }
}

/**
 * Queues whatever the backend has not seen. Called after the application is
 * saved, and returns as soon as the row is written — the sending is the
 * worker's problem.
 *
 * The conversation travels with the fields rather than on its own, because
 * that is where their API takes it: one `messages` array on the same ingest
 * call, re-sent freely because duplicates are ignored. It is tracked as a
 * single hashed key, so a thread that has grown queues and one that has not
 * does not.
 */
export async function queueFields(
  id: string,
  flow: Record<string, unknown>,
  history: unknown[] = [],
  sent?: Record<string, unknown>,
): Promise<number> {
  if (!pushReady()) return 0
  const seen = sent ?? (await known(id)).pushed ?? {}

  const full = ingestBody(id, flow, history)
  const changed = delta(trackable(full, sha), seen)
  const names = Object.keys(changed)
  if (!names.length) return 0

  // Only what changed, rebuilt into their nesting — `collected` and
  // `validation_results` merge sub-key by sub-key at their end. The transcript
  // is the exception: its key holds a hash, so the messages themselves are
  // carried whole whenever that hash has moved.
  const patch = unflatten(changed) as Ingest
  if ('messages' in changed) patch.messages = full.messages

  await query(
    `INSERT INTO outbox (application, endpoint, idempotency, body, kind, fields)
     VALUES ($1, '/ingest', $2, $3, 'fields', $4)
     ON CONFLICT (idempotency) DO NOTHING`,
    [
      id,
      // The same change queued twice is the same delivery, so the key is the
      // content rather than the moment: a retry after a crash cannot duplicate.
      `${id}:fields:${sha(JSON.stringify(changed))}`,
      JSON.stringify({ applicationId: id, patch, marks: changed }),
      JSON.stringify(names),
    ],
  )
  return names.length
}

/**
 * Queues a document.
 *
 * The bytes are read at send time, not held in the row — a licence in an
 * outbox row would be a second copy of an identity paper with its own
 * retention story.
 */
export async function queueDocument(
  id: string,
  uploadId: string,
  kind: string,
  verification: unknown,
): Promise<void> {
  if (!pushReady()) return
  await query(
    `INSERT INTO outbox (application, endpoint, idempotency, body, kind, fields)
     VALUES ($1, '/ingest/document', $2, $3, 'document', $4)
     ON CONFLICT (idempotency) DO NOTHING`,
    [
      id,
      `${id}:doc:${uploadId}`,
      JSON.stringify({ applicationId: id, uploadId, kind, verification, mark: uploadId }),
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

type Sent = {
  /** Accepted. The only case in which anything is marked as delivered. */
  ok: boolean
  /** Refused in a way that retrying cannot fix, so stop — but do not pretend. */
  permanent: boolean
  status: number
  detail: string
  submission?: number
}

/**
 * Whether a status is worth trying again.
 *
 * Their rule, and it is not the usual one: retry 5xx, and retry 409 as well,
 * because 409 means the document arrived before the fields it belongs to and
 * the fields row ahead of it in the queue will fix that. Every other 4xx is a
 * payload they will never accept, and leaving it at the head of the queue
 * would block every rider behind it.
 */
const retryable = (status: number) => status >= 500 || status === 408 || status === 429 || status === 409

async function send(row: Due, submission: number | null): Promise<Sent> {
  const url = `${ENDPOINT}${row.endpoint}`
  const headers: Record<string, string> = KEY ? { 'x-ingest-key': KEY } : {}
  try {
    let res: Response
    if (row.kind === 'document') {
      // A document cannot be posted until they have an application to hang it
      // on, and the id for that only exists once a fields call has landed.
      if (!submission)
        return { ok: false, permanent: false, status: 409, detail: 'no submission_id yet' }
      const id = String(row.body['uploadId'] ?? '')
      // From the database if it has fallen out of memory, which it will have:
      // a file sits in memory for half an hour and the backlog this drains can
      // be days old. Reading memory only, every document queued before the
      // endpoint existed was reported as lost while sitting in Postgres.
      const upload = await findUpload(id)
      if (!upload)
        // Genuinely gone: swept at the end of its retention. What was read off
        // it has already gone as fields; the picture is beyond recovery, and
        // saying so is better than retrying forever.
        return { ok: true, permanent: false, status: 410, detail: 'the file is no longer held' }
      const form = new FormData()
      form.append('submission_id', String(submission))
      form.append('kind', String(row.body['kind'] ?? ''))
      form.append('sha256', createHash('sha256').update(upload.bytes).digest('hex'))
      form.append('file', new Blob([upload.bytes as BlobPart], { type: upload.mime }), upload.name)
      res = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(TIMEOUT) })
    } else {
      const patch = (row.body['patch'] ?? {}) as Ingest
      res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        // The id they gave us once they have one; ours until then, which is
        // what stops a retried first call creating a second application.
        body: JSON.stringify(
          submission
            ? { submission_id: submission, ...patch }
            : { applicationId: row.body['applicationId'], ...patch },
        ),
        signal: AbortSignal.timeout(TIMEOUT),
      })
    }
    const text = (await res.text()).slice(0, 300)
    let got: number | undefined
    if (res.ok) {
      try {
        const n = (JSON.parse(text) as { submission_id?: unknown }).submission_id
        if (typeof n === 'number') got = n
      } catch {
        /* a 200 with something other than JSON is still a 200 */
      }
    }
    return {
      ok: res.ok,
      permanent: !res.ok && !retryable(res.status),
      status: res.status,
      detail: res.ok ? 'ok' : text,
      ...(got ? { submission: got } : {}),
    }
  } catch (err) {
    return {
      ok: false,
      permanent: false,
      status: 0,
      detail: err instanceof Error ? err.message : 'failed',
    }
  }
}

/** Marks what a delivered row carried as acknowledged. */
async function acknowledge(row: Due, result: Sent) {
  /*
   * `pushed` holds the last value they accepted for each name, which is what
   * the next delta is measured against; `pushed_at` holds when. For a document
   * the mark is its upload id, for the transcript a hash of the conversation,
   * so a thread that has since grown queues again and one that has not does not.
   */
  const marks =
    row.kind === 'fields'
      ? ((row.body['marks'] ?? {}) as Record<string, unknown>)
      : Object.fromEntries(row.fields.map((f) => [f, row.body['mark'] ?? true]))

  await query(
    `UPDATE applications
        SET pushed = pushed || $2::jsonb,
            pushed_at = pushed_at || $3::jsonb
            ${result.submission ? ', submission_id = COALESCE(submission_id, $4)' : ''}
      WHERE id = $1`,
    [
      row.application,
      JSON.stringify(marks),
      JSON.stringify(Object.fromEntries(Object.keys(marks).map((f) => [f, new Date().toISOString()]))),
      ...(result.submission ? [result.submission] : []),
    ],
  )
}

let draining = false

/**
 * One pass over what is due.
 *
 * Rows are taken oldest first and sent one at a time — never in parallel, even
 * across riders. Their API overwrites when two updates for one application are
 * in flight together, and a queue that is only ever one deep cannot do that.
 * Safe to call often; it will not overlap itself.
 */
export async function drain(limit = 20): Promise<{ sent: number; failed: number }> {
  if (!pushReady() || draining) return { sent: 0, failed: 0 }
  draining = true
  let sent = 0
  let failed = 0
  /** Submission ids learned in this pass, so a document need not wait a tick. */
  const ids = new Map<string, number | null>()
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
      if (!ids.has(row.application)) ids.set(row.application, (await known(row.application)).submission_id)
      const result = await send(row, ids.get(row.application) ?? null)
      if (result.submission) ids.set(row.application, result.submission)
      if (result.ok) {
        await acknowledge(row, result)
        await query(`DELETE FROM outbox WHERE id = $1`, [row.id])
        sent++
        continue
      }
      failed++
      /*
       * Refused for good. It stops being retried — a payload they will never
       * accept would otherwise sit at the head of the queue holding up every
       * rider behind it — but it is emphatically not acknowledged, and the row
       * stays with its reason on it.
       *
       * This used to count as a delivery. A 400 marked every field in it as
       * received, so an application their API had rejected outright looked, on
       * our side, exactly like one that had landed.
       */
      await query(
        `UPDATE outbox
            SET attempts = $2,
                next_attempt = now() + ($3 || ' milliseconds')::interval,
                last_error = $4
          WHERE id = $1`,
        [
          row.id,
          result.permanent ? MAX_ATTEMPTS : row.attempts + 1,
          backoff(row.attempts + 1),
          `${result.status}: ${result.detail}`,
        ],
      )
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
  const rows = await query<{
    id: string
    flow: Record<string, unknown>
    history: unknown[]
    pushed: Record<string, unknown>
  }>(
    `SELECT id, flow, history, pushed FROM applications
      WHERE updated_at > now() - ($1 || ' days')::interval
      ORDER BY updated_at DESC
      LIMIT $2`,
    [days, limit],
  )
  let queued = 0
  for (const row of rows ?? [])
    queued += await queueFields(row.id, row.flow, row.history ?? [], row.pushed ?? {})
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
  // Voice notes travel as a link, because their document endpoint takes images
  // and PDFs only. Without a public address for this server the transcript
  // still arrives and the recordings do not — worth saying out loud.
  if (!host())
    console.warn('push: no APP_URL or RAILWAY_PUBLIC_DOMAIN — voice notes will be sent as text only')
  setInterval(() => void drain(), everyMs).unref()
  // Once shortly after boot, then slowly: the first catches everything
  // collected before the endpoint existed, the rest catches anything a crash
  // left unqueued.
  setTimeout(() => void backfill(), 10_000).unref()
  setInterval(() => void backfill(), sweepMs).unref()
}
