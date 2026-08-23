import { openCompletion, type Effort, type Msg } from './provider.ts'

export type TurnEvent =
  | { type: 'delta'; i: number; t: string }
  | { type: 'done'; n: number }
  | { type: 'error'; message: string }

type Sub = (ev: TurnEvent) => void

type Turn = {
  id: string
  chunks: string[]
  done: boolean
  error?: string
  touched: number
  subs: Set<Sub>
  abort: AbortController
}

const turns = new Map<string, Turn>()
const TTL = 5 * 60_000

/**
 * Pakistan international transit is lossy, and Railway's edge speaks HTTP/2 over
 * TCP, so a dropped packet head-of-line-blocks the token stream. We buffer the
 * turn server-side and keep consuming upstream even with no subscriber attached,
 * so a client that drops mid-answer can resume from its last index instead of
 * losing the turn and paying for it twice.
 */
export function startTurn(messages: Msg[], effort: Effort): Turn {
  const id = crypto.randomUUID()
  const turn: Turn = {
    id,
    chunks: [],
    done: false,
    touched: Date.now(),
    subs: new Set(),
    abort: new AbortController(),
  }
  turns.set(id, turn)
  void pump(turn, messages, effort)
  return turn
}

function emit(turn: Turn, ev: TurnEvent) {
  turn.touched = Date.now()
  for (const sub of turn.subs) {
    try {
      sub(ev)
    } catch {
      /* a dead subscriber must not kill the turn */
    }
  }
}

async function pump(turn: Turn, messages: Msg[], effort: Effort) {
  try {
    const res = await openCompletion(messages, effort, turn.abort.signal)

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      let message = `Upstream error ${res.status}`
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } }
        if (parsed.error?.message) message = parsed.error.message
      } catch {
        if (body) message = body.slice(0, 300)
      }
      turn.error = message
      turn.done = true
      emit(turn, { type: 'error', message })
      return
    }

    const decoder = new TextDecoder()
    let buf = ''
    let finishReason: string | null = null

    for await (const bytes of res.body) {
      buf += decoder.decode(bytes as Uint8Array, { stream: true })

      let sep: number
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep)
        buf = buf.slice(sep + 2)

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue

          let text: string | undefined
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string }; finish_reason?: string }[]
            }
            finishReason = json.choices?.[0]?.finish_reason ?? finishReason
            text = json.choices?.[0]?.delta?.content
          } catch {
            continue
          }
          if (!text) continue

          const i = turn.chunks.length
          turn.chunks.push(text)
          emit(turn, { type: 'delta', i, t: text })
        }
      }
    }

    // A turn that ends with nothing to show must say so. Silence reads as a
    // broken app, and the rider has no way to tell the difference.
    if (turn.chunks.length === 0) {
      const message =
        finishReason === 'length'
          ? 'Maazrat, jawab poora nahi ho saka. Baraye meherbani chota sawal kar ke dobara poochein.'
          : 'Maazrat, jawab nahi mil saka. Baraye meherbani dobara koshish karein.'
      turn.error = message
      turn.done = true
      emit(turn, { type: 'error', message })
      return
    }

    turn.done = true
    emit(turn, { type: 'done', n: turn.chunks.length })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Upstream connection failed'
    turn.error = message
    turn.done = true
    emit(turn, { type: 'error', message })
  }
}

/** Replay everything from `from`, then attach for live deltas. */
export function subscribe(turn: Turn, from: number, send: Sub): () => void {
  for (let i = Math.max(0, from); i < turn.chunks.length; i++) {
    send({ type: 'delta', i, t: turn.chunks[i]! })
  }
  if (turn.done) {
    send(
      turn.error
        ? { type: 'error', message: turn.error }
        : { type: 'done', n: turn.chunks.length },
    )
    return () => {}
  }
  turn.subs.add(send)
  return () => turn.subs.delete(send)
}

export function getTurn(id: string): Turn | undefined {
  return turns.get(id)
}

setInterval(() => {
  const cutoff = Date.now() - TTL
  for (const [id, t] of turns) {
    if (t.touched < cutoff) {
      if (!t.done) t.abort.abort()
      turns.delete(id)
    }
  }
}, 60_000).unref()
