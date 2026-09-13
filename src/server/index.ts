import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { Hono, type Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { authRequired, grant, guard, isAuthed } from './auth.ts'
import { allow } from './limit.ts'
import {
  completeJson,
  MODEL,
  startWarmer,
  type Effort,
  type Msg,
  listModels,
} from './provider.ts'
import { accept, get as getUpload } from './uploads.ts'
import type { DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { warmOcr } from './ocr.ts'
import { extractName } from './extract.ts'
import { STEP_SPECS } from '../shared/steps.ts'
import { closeApplication, findOpen, isUuid, loadApplication, saveApplication } from './applications.ts'
import { transcodeReady } from './audio.ts'
import { visionReady } from './vision.ts'
import { detailPage, listPage, loginPage, type Row as AdminRow, type Waiting } from './admin.ts'
import { QUESTIONS } from '../shared/quiz.ts'
import {
  backfill,
  drain,
  forBackend,
  pending,
  pushReady,
  queueDepth,
  queueDocument,
  queueFields,
  startPushing,
} from './push.ts'
import { transcribe } from './transcribe.ts'
import { audioFor, speak, speechReady } from './speak.ts'
import { init as initDb, dbReady, query, sweep } from './db.ts'
import { announceFee, CHARGE_PAISA, FEE_PAISA, feeOverridden } from './fee.ts'
import { verifyDocument } from './verify.ts'
import { facialReady, matchFace, ocrReady } from './rozee.ts'
import { checkWallet, rizqReady } from './rizq.ts'
import { anyRailReady, inquire, newRef, payEasypaisa, payJazzcash } from './pay.ts'
import { handleIncoming, type Incoming } from './whatsapp/engine.ts'
import { validSignature, VERIFY_TOKEN, whatsappReady } from './whatsapp/client.ts'
import { getTurn, startTurn, subscribe, type TurnEvent } from './turns.ts'
import { forModel } from '../shared/wire.ts'

const app = new Hono()
const MAX_MESSAGES = 24
const MAX_CHARS = 32_000

const clientIp = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
  c.req.header('x-real-ip') ??
  'unknown'

// The commit is here so a deploy can be waited on with one cheap request
// rather than by polling the Railway CLI, which is slow and easy to get wrong.
const COMMIT = (process.env.RAILWAY_GIT_COMMIT_SHA ?? '').slice(0, 7)


app.get('/healthz', (c) =>
  c.json({
    ok: true,
    model: MODEL,
    commit: COMMIT,
    whatsapp: whatsappReady,
    speech: speechReady(),
    db: dbReady(),
    fee: FEE_PAISA,
    rails: anyRailReady(),
    // Whether a 3gp or AMR voice note from a phone's recorder app can be read.
    transcode: transcodeReady(),
    // The verifications. A missing credential used to show up only as "not
    // run" on the rider's data screen, after a real CNIC had been uploaded.
    ocr: ocrReady(),
    facial: facialReady(),
    rizq: rizqReady(),
    // The licence reader of last resort, for cards the labels do not know.
    vision: visionReady(),
    push: pushReady(),
    // The queue's depth as the worker last saw it: 0 means everything the
    // backend is owed has been delivered.
    ...(pushReady() ? { outbox: queueDepth().rows, stuck: queueDepth().stuck } : {}),
    // Present only when a test override is active, so it cannot ship unseen.
    ...(feeOverridden ? { feeChargedInstead: CHARGE_PAISA } : {}),
  }),
)

// ---------------------------------------------------------------- WhatsApp --
// Meta calls these, so they sit outside the password gate. Authenticity comes
// from the signature instead.

/** Meta's subscription handshake: echo the challenge if the token matches. */
app.get('/webhook/whatsapp', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge') ?? ''
  if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN)
    return c.text(challenge, 200)
  return c.text('Forbidden', 403)
})

// Meta retries anything it does not see acknowledged quickly, and it redelivers
// on retry, so ids are remembered to avoid running a step twice.
const handled = new Set<string>()
setInterval(() => handled.clear(), 30 * 60_000).unref()

app.post('/webhook/whatsapp', async (c) => {
  const raw = await c.req.text()
  if (!validSignature(raw, c.req.header('x-hub-signature-256'))) {
    console.error('whatsapp: rejected a webhook with a bad signature')
    return c.text('Forbidden', 403)
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return c.text('Bad Request', 400)
  }

  const incoming = parseWebhook(body)

  // Acknowledge first: OCR and a model call take longer than Meta will wait.
  void (async () => {
    for (const msg of incoming) {
      if (handled.has(msg.id)) continue
      handled.add(msg.id)
      try {
        await handleIncoming(msg)
      } catch (err) {
        console.error('whatsapp: handler failed', err instanceof Error ? err.message : err)
      }
    }
  })()

  return c.text('EVENT_RECEIVED', 200)
})

function parseWebhook(body: unknown): Incoming[] {
  const out: Incoming[] = []
  const b = body as {
    entry?: { changes?: { value?: { messages?: Record<string, any>[] } }[] }[]
  }
  for (const entry of b.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const m of change.value?.messages ?? []) {
        if (!m.from || !m.id || !m.type) continue
        out.push({
          from: String(m.from),
          id: String(m.id),
          type: String(m.type),
          text: m.text?.body ? String(m.text.body) : undefined,
          mediaId:
            m.image?.id ?? m.document?.id ?? m.audio?.id ?? m.voice?.id ?? undefined,
          mime:
            m.image?.mime_type ??
            m.document?.mime_type ??
            m.audio?.mime_type ??
            m.voice?.mime_type ??
            undefined,
          latitude: m.location?.latitude,
          longitude: m.location?.longitude,
        })
      }
  return out
}
// -------------------------------------------------------------- /WhatsApp --

// Cheap endpoint the client hits on composer focus and on an idle timer, purely
// to keep the browser's TLS connection to Railway's edge warm. A cold handshake
// from Pakistan measured ~207ms; this makes the user never pay it.
app.get('/api/ping', (c) => {
  c.header('cache-control', 'no-store')
  return c.body(null, 204)
})

app.get('/api/session', (c) => c.json({ authed: isAuthed(c), authRequired }))

app.post('/api/login', async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Too many attempts' }, 429)
  const body = await c.req.json().catch(() => ({}) as { password?: string })
  if (!grant(c, String(body.password ?? '')))
    return c.json({ error: 'Wrong password' }, 401)
  return c.json({ ok: true })
})

function sseHeaders(c: {
  header: (k: string, v: string) => void
}) {
  c.header('content-type', 'text/event-stream')
  c.header('cache-control', 'no-cache, no-transform')
  c.header('connection', 'keep-alive')
  // Belt and braces against any intermediary buffering the token stream.
  c.header('x-accel-buffering', 'no')
}

async function relay(
  stream: SSEStreamingApi,
  turnId: string,
  from: number,
): Promise<void> {
  const turn = getTurn(turnId)
  if (!turn) {
    await stream.writeSSE({
      event: 'error',
      data: JSON.stringify({
        type: 'error',
        message: 'This turn expired. Send it again.',
      }),
    })
    return
  }

  const queue: TurnEvent[] = []
  let settled = false
  let wake: (() => void) | null = null

  const unsubscribe = subscribe(turn, from, (ev) => {
    queue.push(ev)
    if (ev.type === 'done' || ev.type === 'error') settled = true
    wake?.()
  })

  stream.onAbort(() => {
    unsubscribe()
    wake?.()
  })

  const drain = async () => {
    while (queue.length) {
      const ev = queue.shift()!
      await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) })
    }
  }

  while (!stream.aborted && !stream.closed) {
    await drain()
    if (settled) break

    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      new Promise<'wake'>((resolve) => {
        wake = () => resolve('wake')
      }),
      new Promise<'idle'>((resolve) => {
        timer = setTimeout(() => resolve('idle'), 15_000)
      }),
    ])
    if (timer) clearTimeout(timer)
    wake = null

    // Only on a genuine idle gap, to stop intermediaries closing the stream.
    if (outcome === 'idle' && !queue.length && !settled) {
      await stream.writeSSE({ event: 'hb', data: '1' })
    }
  }

  await drain()
  unsubscribe()
}

const DOC_KINDS: DocKind[] = ['cnic_front', 'cnic_back', 'license', 'bill']
const asDocKind = (v: unknown): DocKind | null =>
  typeof v === 'string' && (DOC_KINDS as string[]).includes(v) ? (v as DocKind) : null

app.post('/api/upload', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)

  const body = await c.req.parseBody().catch(() => null)
  const file = body?.['file']
  if (!(file instanceof File))
    return c.json({ error: 'Koi file nahi mili.' }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = accept(file.name, bytes)
  if (!result.ok) return c.json({ error: result.reason }, 400)

  const { id, name, mime, size } = result.upload
  const kind = asDocKind(body?.['kind'])
  const expectedName = typeof body?.['expectedName'] === 'string' ? body['expectedName'] : ''
  const expectedCnic =
    typeof body?.['expectedCnic'] === 'string' ? body['expectedCnic'].replace(/\D/g, '') : ''

  const verification = await verifyDocument({
    kind,
    bytes,
    mime,
    expectedName,
    expectedCnic,
  })

  /**
   * A selfie is only meaningful next to the card it is supposed to be of, so
   * the client sends the id of the CNIC it already uploaded. Both are still in
   * memory at this point, which is the whole reason this happens here.
   *
   * The result never blocks: a low score sends the rider back for a better
   * photograph, and a service that does not answer is recorded as unchecked
   * for branch staff rather than held against them.
   */
  let face: Awaited<ReturnType<typeof matchFace>> | null = null
  const againstId = typeof body?.['against'] === 'string' ? body['against'] : ''
  if (kind === null && againstId && facialReady()) {
    const card = getUpload(againstId)
    if (card) face = await matchFace(card.bytes, bytes)
    else face = { outcome: 'unavailable', reason: 'the CNIC is no longer held', latency: 0 }
  }

  // The picture itself goes to the backend too, with what we made of it. The
  // bytes are read when the row is sent, not held in it.
  const application = typeof body?.['applicationId'] === 'string' ? body['applicationId'] : ''
  if (application && kind) void queueDocument(application, id, kind, verification)

  return c.json({ id, name, mime, size, verification, face })
})

app.get('/api/upload/:id', guard, (c) => {
  const u = getUpload(c.req.param('id') ?? '')
  if (!u) return c.json({ error: 'Not found' }, 404)
  c.header('content-type', u.mime)
  c.header('cache-control', 'private, max-age=600')
  c.header('content-disposition', `inline; filename="${encodeURIComponent(u.name)}"`)
  return c.body(u.bytes as unknown as ArrayBuffer)
})

// Asking for a line to be spoken costs an Uplift call, so it is gated.
app.post('/api/speak', guard, async (c) => {
  if (!allow(clientIp(c), 'speech')) return c.json({ error: 'Rate limited' }, 429)
  if (!speechReady()) return c.json({ ok: false, reason: 'unavailable' })

  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text : ''
  const id = await speak(text)
  return id ? c.json({ ok: true, id }) : c.json({ ok: false, reason: 'unavailable' })
})

// Fetching one is open: WhatsApp audio is collected by Meta, not by the rider,
// and the id cannot be guessed without already knowing the words.
app.get('/api/speak/:id', async (c) => {
  const found = await audioFor(c.req.param('id'))
  if (!found) return c.text('Not found', 404)
  return c.body(found.bytes as unknown as ArrayBuffer, 200, {
    'content-type': found.mime,
    'cache-control': 'public, max-age=86400',
  })
})

// ------------------------------------------------------------ applications --
// Every change a rider makes is written here as it is made, and a rider who
// comes back — on the same phone or another — is put back where they were.

const HISTORY_CAP = 256 * 1024
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '')

app.put('/api/application/:id', guard, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) return c.json({ error: 'Bad id' }, 400)
  const raw = await c.req.text()
  if (raw.length > HISTORY_CAP) return c.json({ error: 'Too big' }, 413)
  let body: { flow?: Record<string, unknown>; history?: unknown[] } = {}
  try {
    body = JSON.parse(raw)
  } catch {
    return c.json({ error: 'Bad body' }, 400)
  }
  const flow = body.flow && typeof body.flow === 'object' ? body.flow : null
  const history = Array.isArray(body.history) ? body.history : null
  if (!flow || !history) return c.json({ error: 'Bad body' }, 400)
  const step = typeof flow['step'] === 'number' ? flow['step'] : 0
  const ok = await saveApplication(id, {
    flow,
    history,
    phone: digits(flow['phone']) || undefined,
    fullName: typeof flow['fullName'] === 'string' ? flow['fullName'] : undefined,
    step,
    done: step >= STEP_SPECS.length,
  })
  // Queued, not sent: the rider's next message must not wait on somebody
  // else's server. A worker drains the queue behind them.
  const queued = ok ? await queueFields(id, flow) : 0
  return c.json({ ok, queued })
})

app.post('/api/application/:id/close', guard, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) return c.json({ error: 'Bad id' }, 400)
  return c.json({ ok: await closeApplication(id) })
})

app.post('/api/application/lookup', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const phone = digits(body['phone'])
  const name = typeof body['name'] === 'string' ? body['name'] : ''
  if (!phone || !name.trim()) return c.json({ found: false })
  const found = await findOpen(phone, name, String(body['exclude'] ?? ''))
  return c.json(found ? { found: true, ...found } : { found: false })
})

app.post('/api/application/resume', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const id = body['id']
  const phone = digits(body['phone'])
  const name = typeof body['name'] === 'string' ? body['name'] : ''
  if (!isUuid(id) || !phone || !name.trim()) return c.json({ error: 'Not found' }, 404)
  const snap = await loadApplication(id, phone, name)
  return snap ? c.json(snap) : c.json({ error: 'Not found' }, 404)
})

app.post('/api/transcribe', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)

  const body = await c.req.parseBody().catch(() => null)
  const file = body?.['file']
  if (!(file instanceof File)) return c.json({ ok: false, reason: 'empty' }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await transcribe(bytes, file.type || 'audio/webm')
  return c.json(result)
})

app.post('/api/extract-name', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text : ''
  const guess = await extractName(text)
  return c.json({
    is_name: guess.isName,
    full_name: guess.fullName,
    first_name: guess.firstName,
  })
})

// Compares two names taken off documents — the licence against the CNIC.
/**
 * Whose wallet is the rider's number? Asked once, after the CNIC is read,
 * because it is the name on the card that the title is compared against.
 */
/**
 * Takes the registration fee. Called once, at the end, and only for a rider
 * whose checks passed — the client decides that; this route does the debit.
 */
app.post('/api/pay', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as {
    rail?: unknown
    phone?: unknown
    cnic?: unknown
  }
  const rail = body.rail === 'jazzcash' ? 'jazzcash' : 'easypaisa'
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const cnic = typeof body.cnic === 'string' ? body.cnic : ''
  if (!phone) return c.json({ state: 'failed', detail: 'no number' })

  const ref = newRef(rail)
  const attempt =
    rail === 'jazzcash' ? await payJazzcash(phone, cnic, ref) : await payEasypaisa(phone, ref)
  console.log(`pay: ${attempt.rail} ${attempt.state} ${attempt.ref} — ${attempt.detail}`)
  return c.json(attempt)
})

/**
 * What became of a payment. The rider approves the debit in their wallet app,
 * which takes as long as it takes; the page asks here every few seconds until
 * the rail says paid or failed, or a minute has gone by.
 */
app.post('/api/pay/status', guard, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { rail?: unknown; ref?: unknown }
  const rail = body.rail === 'jazzcash' ? 'jazzcash' : 'easypaisa'
  const ref = typeof body.ref === 'string' ? body.ref.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : ''
  if (!ref) return c.json({ state: 'failed', detail: 'no reference' })
  const attempt = await inquire(rail, ref)
  console.log(`pay: ${attempt.rail} inquiry ${attempt.ref} → ${attempt.state} — ${attempt.detail}`)
  return c.json(attempt)
})

/**
 * Which models this Groq key can use. Temporary: Groq refuses connections from
 * some networks, so the choice of a vision model has to be made from where the
 * app actually runs.
 */
app.get('/api/models', guard, async (c) => c.json(await listModels()))

/**
 * Sends whatever is waiting, now, rather than at the next tick. For turning the
 * push on without waiting, and for seeing what a failing backend says.
 */
app.post('/api/push/drain', guard, async (c) => {
  if (!pushReady()) return c.json({ error: 'no ROZEENA_ENDPOINT' }, 409)
  const filled = await backfill()
  const result = await drain(100)
  return c.json({ backfilled: filled, ...result, ...(await pending()) })
})

/**
 * Every application, newest first — who applied, how far they got, and what
 * was made of their documents.
 *
 * Read-only and summary-level: no document bytes, no history. Behind the
 * password like everything else, because it is a list of real people's names,
 * numbers and CNICs.
 */
/**
 * The recruiter's view. Behind the same password as everything else, because
 * it is a list of real people's names, numbers and CNICs.
 */
app.get('/admin', async (c) => {
  // Not `guard`: that answers with JSON, which is right for the app and
  // useless for a page. A person gets a way in instead.
  if (!isAuthed(c)) return c.html(loginPage())
  const id = c.req.query('id') ?? ''
  const waiting =
    (await query<Waiting>(
      `SELECT application, fields, attempts, last_error FROM outbox ORDER BY id`,
    )) ?? []

  if (id) {
    if (!isUuid(id)) return c.text('Bad id', 400)
    const rows = await query<AdminRow>(
      `SELECT id, phone, full_name, step, completed, flow, history, created_at, updated_at, pushed_at
         FROM applications WHERE id = $1`,
      [id],
    )
    const row = rows?.[0]
    if (!row) return c.text('Not found', 404)
    return c.html(detailPage(row, waiting, pushReady(), QUESTIONS))
  }

  const rows = await query<AdminRow>(
    `SELECT id, phone, full_name, step, completed, flow, history, created_at, updated_at, pushed_at
       FROM applications ORDER BY updated_at DESC LIMIT 200`,
  )
  if (!rows) return c.text('No database', 503)
  return c.html(listPage(rows, waiting, pushReady()))
})

app.get('/api/applications', guard, async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)))
  const rows = await query<{
    id: string
    phone: string | null
    full_name: string | null
    step: number
    completed: boolean
    flow: Record<string, unknown>
    created_at: Date
    updated_at: Date
    pushed_at: Record<string, string>
  }>(
    `SELECT id, phone, full_name, step, completed, flow, created_at, updated_at, pushed_at
       FROM applications
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit],
  )
  if (!rows) return c.json({ error: 'no database' }, 503)

  return c.json({
    count: rows.length,
    applications: rows.map((r) => {
      const f = r.flow ?? {}
      const collected = (f['collected'] ?? {}) as Record<string, string>
      const payment = (f['payment'] ?? null) as Record<string, unknown> | null
      const quiz = (f['quiz'] ?? null) as Record<string, unknown> | null
      return {
        id: r.id,
        startedAt: r.created_at,
        updatedAt: r.updated_at,
        name: r.full_name,
        phone: r.phone,
        cnic: f['cnic'] ?? null,
        step: `${r.step} of ${STEP_SPECS.length}`,
        completed: r.completed,
        wallet: f['rail'] ?? null,
        missing: f['missing'] ?? [],
        branch: f['branch'] ?? null,
        checks: {
          face: collected['checks.faceMatch'] ?? null,
          licenceVsCnic: collected['checks.licenceVsCnic'] ?? null,
          wallet: collected['checks.wallet'] ?? null,
        },
        documents: ['license', 'cnic_front', 'selfie'].filter((k) => collected[`${k}.uploadId`]),
        payment: payment
          ? { state: payment['state'], rail: payment['rail'], amountPaisa: payment['amountPaisa'], ref: payment['ref'] }
          : null,
        quiz: quiz
          ? { offered: quiz['offered'], declined: quiz['declined'], done: quiz['done'], answered: (quiz['answers'] as unknown[] ?? []).length }
          : null,
        pushedFields: Object.keys(r.pushed_at ?? {}).length,
      }
    }),
  })
})

app.get('/api/application/:id/push', guard, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) return c.json({ error: 'Bad id' }, 400)
  const rows = await query<{ flow: Record<string, unknown>; pushed_at: Record<string, string> }>(
    `SELECT flow, pushed_at FROM applications WHERE id = $1`,
    [id],
  )
  const row = rows?.[0]
  if (!row) return c.json({ error: 'Not found' }, 404)
  type Owed = { kind: string; fields: string[]; attempts: number; last_error: string | null }
  const owed = await query<Owed>(
    `SELECT kind, fields, attempts, last_error FROM outbox WHERE application = $1 ORDER BY id`,
    [id],
  )
  const now = forBackend(row.flow)
  return c.json({
    endpoint: pushReady(),
    delivered: row.pushed_at ?? {},
    waiting: (owed ?? []).flatMap((o: Owed) => o.fields),
    neverQueued: Object.keys(now).filter(
      (f) => !(f in (row.pushed_at ?? {})) && !(owed ?? []).some((o: Owed) => o.fields.includes(f)),
    ),
    attempts: owed ?? [],
  })
})

app.post('/api/wallet', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as { phone?: unknown; name?: unknown }
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  const name = typeof body.name === 'string' ? body.name : ''
  if (!phone || !name) return c.json({ outcome: 'unavailable', reason: 'nothing to check' })
  return c.json(await checkWallet(phone, name))
})

app.post('/api/compare-names', guard, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { a?: unknown; b?: unknown }
  const a = typeof body.a === 'string' ? body.a.slice(0, 200) : ''
  const b = typeof body.b === 'string' ? body.b.slice(0, 200) : ''
  if (!a || !b) return c.json({ verdict: null })
  const r = compareNames(a, b)
  return c.json({ verdict: r.verdict, score: r.score, reason: r.reason })
})

app.post('/api/chat', guard, async (c) => {
  if (!allow(clientIp(c)))
    return c.json({ error: 'Slow down a moment — rate limited.' }, 429)

  const body = (await c.req.json().catch(() => ({}))) as {
    messages?: unknown
    effort?: unknown
  }

  const incoming: unknown[] = Array.isArray(body.messages) ? body.messages : []
  if (!incoming.length) return c.json({ error: 'No messages' }, 400)

  // Rebuilt, not merely checked: a message in the thread also carries how it is
  // drawn, and Groq rejects the whole request if any of that reaches it.
  const clean: Msg[] = forModel(incoming).slice(-MAX_MESSAGES)

  if (!clean.length) return c.json({ error: 'No usable messages' }, 400)
  const total = clean.reduce((n: number, m: Msg) => n + m.content.length, 0)
  if (total > MAX_CHARS) return c.json({ error: 'Conversation too long' }, 413)

  const effort: Effort =
    body.effort === 'medium' || body.effort === 'high' ? body.effort : 'low'

  const turn = startTurn(clean, effort)

  sseHeaders(c)
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'meta', data: JSON.stringify({ turnId: turn.id }) })
    await relay(stream, turn.id, 0)
  })
})

app.get('/api/chat/resume', guard, async (c) => {
  const turnId = c.req.query('turn') ?? ''
  const from = Number.parseInt(c.req.query('from') ?? '0', 10) || 0
  sseHeaders(c)
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'meta', data: JSON.stringify({ turnId }) })
    await relay(stream, turnId, from)
  })
})

/**
 * The voice note has to be served as audio/ogg: Meta accepts opus only in an ogg
 * container and checks the content type when it fetches the link, and iOS will
 * not play an m4a delivered as application/octet-stream.
 */
const AUDIO_TYPES: Record<string, string> = {
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

/**
 * What a phone may keep, and for how long. Nothing was said before, so phones
 * kept the old index.html and the old bundle on their own judgement — and a
 * focus group tested a build that had been replaced twice. The page itself is
 * always re-checked; the bundles it names carry a hash in the name and never
 * change, so they can be kept for good; everything else for a day.
 */
const cacheFor = (path: string, c: Context) => {
  if (path.endsWith('index.html')) c.header('cache-control', 'no-cache')
  else if (path.includes('/assets/')) c.header('cache-control', 'public, max-age=31536000, immutable')
  else c.header('cache-control', 'public, max-age=86400')
}

/**
 * The page carries the whole app, so it is re-checked on every open — and
 * with a tag that check is a 304 and a few hundred bytes, not 160 KB on 3G.
 * Held in memory with its hash: the static handler streams, and a streamed
 * body cannot be tagged.
 */
const PAGE_PATH = './dist/client/index.html'
let page$: { mtime: number; body: Buffer; tag: string } | null = null
const loadPage = () => {
  // Re-read when the file changes, so a rebuild reaches a running server —
  // in development, where the app is rebuilt under it; in production the
  // check is one stat per request.
  try {
    const mtime = statSync(PAGE_PATH).mtimeMs
    if (page$?.mtime !== mtime) {
      const body = readFileSync(PAGE_PATH)
      page$ = { mtime, body, tag: `"${createHash('sha1').update(body).digest('hex').slice(0, 20)}"` }
    }
    return page$
  } catch {
    return null // no build yet
  }
}
const page = (c: Context) => {
  const p = loadPage()
  if (!p) return c.text('Not built', 503)
  const headers = { etag: p.tag, 'cache-control': 'no-cache' }
  if (c.req.header('if-none-match') === p.tag) return c.body(null, 304, headers)
  return c.body(p.body as unknown as ArrayBuffer, 200, { ...headers, 'content-type': 'text/html; charset=utf-8' })
}
app.get('/', page)
app.get('/index.html', page)

app.use(
  '/*',
  serveStatic({
    root: './dist/client',
    onFound: (path, c) => {
      const ext = path.slice(path.lastIndexOf('.'))
      const type = AUDIO_TYPES[ext]
      if (type) c.header('content-type', type)
      cacheFor(path, c)
    },
  }),
)
app.get('*', page)

startWarmer()
startPushing()
warmOcr()
announceFee()
// Not awaited: a database that is slow to answer should delay nobody. Every
// call through it already degrades to memory when it is not there.
void initDb().then(() => void sweep())
setInterval(() => void sweep(), 6 * 60 * 60_000).unref()

const port = Number(process.env.PORT ?? 3099)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`grok-bot listening on :${info.port} — model ${MODEL}`)
})
