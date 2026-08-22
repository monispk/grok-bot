import type { Message } from './storage.ts'

export type Handlers = {
  onDelta: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
  onUnauthorized: () => void
}

const RETRIES = 4

/**
 * Runs one turn to completion, surviving a dropped connection.
 *
 * The server buffers the turn, so if the socket dies mid-answer we reconnect to
 * /api/chat/resume with the index of the last delta we saw and carry on. On a
 * lossy Pakistani link that turns a lost answer into a brief stall — and avoids
 * paying Groq for the same tokens twice.
 */
export async function runTurn(
  messages: Message[],
  h: Handlers,
  signal: AbortSignal,
): Promise<void> {
  let turnId: string | null = null
  let next = 0
  let attempts = 0

  for (;;) {
    try {
      const res = turnId
        ? await fetch(
            `/api/chat/resume?turn=${encodeURIComponent(turnId)}&from=${next}`,
            { signal, headers: { accept: 'text/event-stream' } },
          )
        : await fetch('/api/chat', {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              accept: 'text/event-stream',
            },
            body: JSON.stringify({ messages }),
          })

      if (res.status === 401) return h.onUnauthorized()
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(detail?.error ?? `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let ended = false

      outer: for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep)
          buf = buf.slice(sep + 2)

          let event = 'message'
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }

          if (event === 'hb') continue
          if (event === 'meta') {
            turnId = (JSON.parse(data) as { turnId: string }).turnId
            attempts = 0
            continue
          }
          if (event === 'delta') {
            const d = JSON.parse(data) as { i: number; t: string }
            if (d.i >= next) {
              next = d.i + 1
              h.onDelta(d.t)
            }
            continue
          }
          if (event === 'done') {
            h.onDone()
            ended = true
            break outer
          }
          if (event === 'error') {
            h.onError((JSON.parse(data) as { message: string }).message)
            ended = true
            break outer
          }
        }
      }

      if (ended) return
      throw new Error('Stream interrupted')
    } catch (err) {
      if (signal.aborted) return
      attempts += 1
      if (!turnId || attempts > RETRIES) {
        h.onError(err instanceof Error ? err.message : 'Connection failed')
        return
      }
      await new Promise((r) => setTimeout(r, Math.min(200 * 2 ** attempts, 2000)))
    }
  }
}

/**
 * Keeps the browser's TLS connection to Railway's edge hot. A cold handshake
 * from Pakistan measured ~207ms; firing this on composer focus means that cost
 * is already paid by the time the user presses Enter.
 */
export function warm() {
  void fetch('/api/ping', { cache: 'no-store' }).catch(() => {})
}
