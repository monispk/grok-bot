import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { authRequired, grant, guard, isAuthed } from './auth.ts'
import { allow } from './limit.ts'
import { MODEL, startWarmer, type Effort, type Msg } from './provider.ts'
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

const port = Number(process.env.PORT ?? 3099)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`grok-bot listening on :${info.port} — model ${MODEL}`)
})
