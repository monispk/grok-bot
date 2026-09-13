type Bucket = { tokens: number; last: number }

/**
 * Two allowances, because two very different things were sharing one.
 *
 * `model` guards what costs tokens and cannot be repeated cheaply: a chat
 * turn, a transcription, a payment. Eight in a burst is generous for a person
 * typing.
 *
 * `speech` guards reading a line aloud, which is neither. The server caches
 * synthesised audio against the words, so the office address is read once for
 * everybody and every later rider is served from the cache. And the ending
 * sends eight lines at once — how it went, the office, the CNIC, the fee, the
 * hours — which on the old single allowance emptied the bucket exactly at the
 * most important message in the flow, leaving the last lines silent.
 */
const LIMITS = {
  model: { capacity: 8, perSecond: 20 / 60 },
  speech: { capacity: 24, perSecond: 60 / 60 },
} as const

export type Guarded = keyof typeof LIMITS

const buckets = new Map<string, Bucket>()

export function allow(ip: string, kind: Guarded = 'model'): boolean {
  const { capacity, perSecond } = LIMITS[kind]
  const key = `${kind}:${ip}`
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: capacity, last: now }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * perSecond)
  b.last = now
  if (b.tokens < 1) {
    buckets.set(key, b)
    return false
  }
  b.tokens -= 1
  buckets.set(key, b)
  return true
}

// Bounded memory: drop buckets that have fully refilled and gone idle.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000
  for (const [key, b] of buckets) if (b.last < cutoff) buckets.delete(key)
}, 60_000).unref()
