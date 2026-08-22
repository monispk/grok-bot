import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { authRequired, grant, guard, isAuthed } from './auth.ts'
import { allow } from './limit.ts'
import {
  completeJson,
  MODEL,
  startWarmer,
  type Effort,
  type Msg,
} from './provider.ts'
import { accept, get as getUpload } from './uploads.ts'
import { inspect, type DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { read, SPARSE_WORDS, warmOcr } from './ocr.ts'
import { getTurn, startTurn, subscribe, type TurnEvent } from './turns.ts'

const app = new Hono()
const MAX_MESSAGES = 24
const MAX_CHARS = 32_000

const clientIp = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
  c.req.header('x-real-ip') ??
  'unknown'

app.get('/healthz', (c) => c.json({ ok: true, model: MODEL }))

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

  // Verification never blocks on its own failure. If OCR is off, or the upload
  // is a PDF we cannot rasterise, the document is accepted and the branch checks
  // the original — the rider is not punished for our pipeline.
  let verification: Record<string, unknown> = { pass: true, checked: false }

  if (kind) {
    const reading = await read(bytes, mime)

    // Almost nothing was read. That is a tilted, blurred or dark photo, and
    // guessing from a partial read is worse than asking for another one.
    if (reading && reading.words.length > 0 && reading.words.length < SPARSE_WORDS) {
      return c.json({
        id, name, mime, size,
        verification: {
          pass: false,
          checked: true,
          reason:
            'Tasveer saaf nahi aayi. Camera ko seedha rakh kar, achi roshni mein dobara khenchein.',
          missing: ['unreadable'],
          fields: {},
        },
      })
    }

    if (reading) {
      const found = inspect(kind, reading)
      let pass = found.pass
      let reason = found.reason

      const cnic = typeof found.fields.cnic === 'string' ? found.fields.cnic : null
      if (pass && expectedCnic && cnic && cnic !== expectedCnic) {
        // 13 exact digits either match or they do not — worth blocking on.
        pass = false
        reason =
          'Is document par CNIC number aap ke CNIC se match nahi kar raha. Baraye meherbani sahi document bhejein.'
      }

      // Names are never blocking: Roman Urdu spelling varies too much to refuse
      // a rider over it. Recorded so the branch can look.
      const docName = typeof found.fields.name === 'string' ? found.fields.name : null
      const nameCheck =
        expectedName && docName ? compareNames(expectedName, docName) : null

      verification = {
        pass,
        checked: true,
        reason,
        missing: found.missing,
        fields: found.fields,
        nameVerdict: nameCheck?.verdict ?? null,
        nameScore: nameCheck?.score ?? null,
      }
    }
  }

  return c.json({ id, name, mime, size, verification })
})

app.get('/api/upload/:id', guard, (c) => {
  const u = getUpload(c.req.param('id') ?? '')
  if (!u) return c.json({ error: 'Not found' }, 404)
  c.header('content-type', u.mime)
  c.header('cache-control', 'private, max-age=600')
  c.header('content-disposition', `inline; filename="${encodeURIComponent(u.name)}"`)
  return c.body(u.bytes as unknown as ArrayBuffer)
})

// Is this reply the rider's name, or a question they asked instead?
const NAME_PROMPT = `You decide whether a message is a person's name.
The user was asked: "Aapka poora naam jo CNIC par hai, kya hai?" (What is your full name as on your CNIC?)
Reply with JSON only: {"is_name": true|false, "full_name": string|null, "first_name": string|null}
If the message is a question, a greeting, or anything other than their own name, set is_name to false and the names to null.
Names may be written in Roman Urdu. Strip words like "mera naam hai" / "my name is". Keep the name's own spelling.`

app.post('/api/extract-name', guard, async (c) => {
  if (!allow(clientIp(c))) return c.json({ error: 'Rate limited' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text.slice(0, 500) : ''
  if (!text) return c.json({ is_name: false })

  const out = await completeJson(NAME_PROMPT, text)
  if (!out) return c.json({ is_name: false, unavailable: true })

  const full = typeof out.full_name === 'string' ? out.full_name.trim() : ''
  const first = typeof out.first_name === 'string' ? out.first_name.trim() : ''
  return c.json({
    is_name: out.is_name === true && full.length > 0,
    full_name: full || null,
    first_name: first || full.split(/\s+/)[0] || null,
  })
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

  const clean: Msg[] = incoming
    .filter((m): m is Msg => {
      const v = m as Msg | null
      return (
        !!v &&
        (v.role === 'user' || v.role === 'assistant') &&
        typeof v.content === 'string'
      )
    })
    .slice(-MAX_MESSAGES)

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

app.use('/*', serveStatic({ root: './dist/client' }))
app.get('*', serveStatic({ path: './dist/client/index.html' }))

startWarmer()
warmOcr()

const port = Number(process.env.PORT ?? 3099)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`grok-bot listening on :${info.port} — model ${MODEL}`)
})
