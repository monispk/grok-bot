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
import type { DocKind } from './fields.ts'
import { compareNames } from './names.ts'
import { warmOcr } from './ocr.ts'
import { extractName } from './extract.ts'
import { verifyDocument } from './verify.ts'
import { handleIncoming, type Incoming } from './whatsapp/engine.ts'
import { validSignature, VERIFY_TOKEN, whatsappReady } from './whatsapp/client.ts'
import { getTurn, startTurn, subscribe, type TurnEvent } from './turns.ts'

const app = new Hono()
const MAX_MESSAGES = 24
const MAX_CHARS = 32_000

const clientIp = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
  c.req.header('x-real-ip') ??
  'unknown'

app.get('/healthz', (c) => c.json({ ok: true, model: MODEL, whatsapp: whatsappReady }))

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
          mediaId: m.image?.id ?? m.document?.id ?? m.audio?.id ?? undefined,
          mime: m.image?.mime_type ?? m.document?.mime_type ?? undefined,
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

/**
 * The voice note has to be served as audio/ogg: Meta accepts opus only in an ogg
 * container and checks the content type when it fetches the link, and iOS will
 * not play an m4a delivered as application/octet-stream.
 */
const AUDIO_TYPES: Record<string, string> = {
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

app.use(
  '/*',
  serveStatic({
    root: './dist/client',
    onFound: (path, c) => {
      const ext = path.slice(path.lastIndexOf('.'))
      const type = AUDIO_TYPES[ext]
      if (type) c.header('content-type', type)
    },
  }),
)
app.get('*', serveStatic({ path: './dist/client/index.html' }))

startWarmer()
warmOcr()

const port = Number(process.env.PORT ?? 3099)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`grok-bot listening on :${info.port} — model ${MODEL}`)
})
