import { Agent, fetch } from 'undici'

export type Effort = 'low' | 'medium' | 'high'
export type Msg = { role: 'user' | 'assistant'; content: string }

const BASE = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'
const KEY = process.env.GROQ_API_KEY ?? ''
export const MODEL = process.env.MODEL ?? 'openai/gpt-oss-120b'
const SYSTEM =
  process.env.SYSTEM_PROMPT ??
  'You are a fast, concise, helpful assistant. Prefer short, direct answers.'

// Measured from Karachi: a cold TLS handshake to api.groq.com costs ~275ms, a warm
// one costs 0. This pool is the single biggest server-side latency lever we control.
const agent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
})

/** Keep at least one TLS session hot so no user ever pays the handshake. */
export function startWarmer() {
  if (!KEY) return
  const ping = async () => {
    try {
      const r = await fetch(`${BASE}/models`, {
        dispatcher: agent,
        headers: { authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(10_000),
      })
      await r.body?.cancel()
    } catch {
      /* a cold pool is a latency problem, not a correctness one */
    }
  }
  void ping()
  // Below keepAliveTimeout so the connection is refreshed before it lapses.
  setInterval(ping, 45_000).unref()
}

export async function openCompletion(
  messages: Msg[],
  effort: Effort,
  signal: AbortSignal,
) {
  return fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    dispatcher: agent,
    signal,
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, ...messages],
      stream: true,
      temperature: 0.7,
      max_completion_tokens: 2048,
      // gpt-oss is a reasoning model. On default effort it burns hundreds of
      // hidden tokens before the first visible one — this is the top TTFT lever.
      reasoning_effort: effort,
      reasoning_format: 'hidden',
    }),
  })
}
